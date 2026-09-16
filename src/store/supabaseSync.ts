import { supabase } from '@/integrations/supabase/client';
import { paginateSelect } from '@/integrations/supabase/pagination';
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink } from '@/types/models';
import { toast } from '@/hooks/use-toast';
import { notifyPersistDebug } from '@/lib/persistDebug';

/** Ensure rank is a finite integer – guards against NaN / undefined / null leaking to the DB. */
const safeRank = (r: unknown): number => (typeof r === 'number' && Number.isFinite(r) ? r : 0);

// Work-item creates/reorders often touch many sibling ranks. Keep those DB
// mutations in call order so fast consecutive adds cannot persist stale ranks
// after newer ones and reshuffle the list on the next refresh.
let workItemMutationQueue: Promise<void> = Promise.resolve();

function enqueueWorkItemMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = workItemMutationQueue.catch(() => undefined).then(operation);
  workItemMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

type WorkItemUpsertRow = {
  id: string;
  title: string;
  description: string | null;
  points: number | null;
  status: string;
  parent_id: string | null;
  parent_id_overrides?: Record<string, string | null>;
  backlog_assignments: Record<string, string>;
  rank: number;
  organization_id: string;
  respawn_enabled: boolean;
  respawn_interval_days: number | null;
  respawn_hour: number | null;
  respawn_minute: number | null;
  respawn_last_triggered_at: string | null;
};

export type WorkItemBacklogRankUpsert = {
  workItemId: string;
  backlogId: string;
  rank: number;
  organizationId: string;
};

export type WorkItemBoardRankUpsert = WorkItemBacklogRankUpsert;

// ─── Pure helpers (used by both load and sync) ────────────────────────────

/**
 * Return the organization that owns an entity, derived from its ID prefix
 * (format: "<orgId>::<rawId>").  Falls back to `defaultOrgId` for unprefixed
 * legacy/mock IDs so that newly-created entities are always attributed to the
 * active org.
 *
 * `sep > 0` (not `>= 0`) is intentional: an ID starting with '::' has an
 * empty org prefix and is treated as unprefixed, falling back to defaultOrgId.
 */
function ownerOrgOf(entityId: string, defaultOrgId: string): string {
  const sep = entityId.indexOf('::');
  return sep > 0 ? entityId.slice(0, sep) : defaultOrgId;
}

/**
 * Returns true when an item's ID prefix embeds a different org than the item's
 * actual `organization_id`.  This happens when items were transferred to a new
 * org but their ID string was not yet renamed.
 */
function isStalePrefix(id: string, effectiveOrgId: string): boolean {
  const sep = id.indexOf('::');
  return sep > 0 && id.slice(0, sep) !== effectiveOrgId;
}

type SupabaseReadResult<T = any> = { data: T[] | null; error: any };

// The rank tables also carry id/organization_id/created_at, none of which are
// read here. Selecting the whole row roughly doubles the cold-start payload
// for these two tables, which are the largest by row count.
const RANK_COLUMNS = 'work_item_id,backlog_id,rank';
const HYPERLINK_COLUMNS = 'id,work_item_id,url,alt_text,rank';

async function loadAllRows(table: string, column: string, value: string): Promise<SupabaseReadResult> {
  const PAGE = 1000;
  const rows: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table as any)
      .select('*')
      .eq(column, value)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...((data ?? []) as any[]));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }
  return { data: rows, error: null };
}

async function loadAllRowsIn(table: string, column: string, values: string[]): Promise<SupabaseReadResult> {
  if (values.length === 0) return { data: [], error: null };
  const PAGE = 1000;
  const rows: any[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table as any)
      .select('*')
      .in(column, values)
      .order('id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) return { data: null, error };
    rows.push(...((data ?? []) as any[]));
    if ((data ?? []).length < PAGE) break;
    from += PAGE;
  }
  return { data: rows, error: null };
}

// ─── Load all data from Supabase (filtered by org) ────────────────────────

export async function loadFromSupabase(
  organizationId: string,
  // Called once trees + backlogs are known, before the far larger work-item
  // and rank payloads land, so the caller can paint the shell early. What is
  // handed over here is final: sanitizeData derives backlogs and trees without
  // consulting work items, so nothing painted now shifts when the items arrive.
  onStructureReady?: (structure: {
    backlogs: Record<string, Backlog>;
    backlogTrees: Record<string, BacklogTree>;
  }) => void,
): Promise<{
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
}> {
  // There used to be a barrier here waiting for the Supabase auth client to
  // finish initialising, so queries could not run against a stale token. Clerk
  // needs no equivalent: the data client asks for a token per request and
  // Clerk hands back a fresh one, so there is nothing to wait for.

  // ── Wave 1: fire all org-scoped queries in parallel ─────────────────────
  // shares, own trees, own work items, and rank tables are all independent.
  // Only the two small structure queries are awaited here — work items and the
  // rank tables are by far the largest payloads, so they stay in flight while
  // the structure is assembled and are awaited once the caller has painted.
  const ownItemsPromise = loadAllRows('work_items', 'organization_id', organizationId);
  const ranksPromise = fetchAllRanksForOrg(organizationId);

  const [sharesRes, ownTreesRes] = await Promise.all([
    supabase.from('backlog_tree_shares' as any).select('tree_id').eq('organization_id', organizationId),
    supabase.from('backlog_trees').select('*').eq('organization_id', organizationId),
  ]);

  const sharedTreeIds = ((sharesRes.data ?? []) as any[]).map((s) => s.tree_id as string);
  if (ownTreesRes.error) throw ownTreesRes.error;

  const ownTreeIds = (ownTreesRes.data ?? []).map((t: any) => t.id as string);

  // ── Wave 2: queries that depend on wave-1 IDs run in parallel ───────────
  const sharedTreesPromise = sharedTreeIds.length > 0
    ? supabase.from('backlog_trees').select('*').in('id', sharedTreeIds)
    : Promise.resolve({ data: [], error: null });

  const outgoingSharesPromise = ownTreeIds.length > 0
    ? supabase.from('backlog_tree_shares' as any).select('organization_id, tree_id').in('tree_id', ownTreeIds)
    : Promise.resolve({ data: [], error: null });

  const [sharedTreesRes, outgoingSharesRes] = await Promise.all([sharedTreesPromise, outgoingSharesPromise]);
  if (sharedTreesRes.error) throw sharedTreesRes.error;

  const allTreeRows = [...(ownTreesRes.data ?? []), ...(sharedTreesRes.data ?? [])];
  const allTreeIds = allTreeRows.map(t => t.id);

  // ── Wave 3: backlogs + partner work items (all independent) ─────────────
  const backlogsPromise = allTreeIds.length > 0
    ? paginateSelect<any>((from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('backlogs' as any).select('*') as any)
          .in('tree_id', allTreeIds)
          .order('id', { ascending: true })
          .range(from, to),
      )
    : Promise.resolve({ data: [], error: null });

  // (A) Incoming: orgs that own the trees shared to us.
  const incomingPartnerOrgIds = sharedTreeIds.length > 0
    ? [...new Set(
        (sharedTreesRes.data ?? [])
          .map((t: any) => t.organization_id as string)
          .filter((id: string) => id !== organizationId)
      )]
    : [];
  const incomingItemsPromise = incomingPartnerOrgIds.length > 0
    ? loadAllRowsIn('work_items', 'organization_id', incomingPartnerOrgIds)
    : Promise.resolve({ data: [], error: null });

  // (B) Outgoing: orgs that have been granted access to our own trees.
  const outgoingPartnerOrgIds = [
    ...new Set(
      ((outgoingSharesRes.data ?? []) as any[])
        .map((s) => s.organization_id as string)
        .filter((id: string) => id !== organizationId)
    ),
  ];
  const outgoingItemsPromise = outgoingPartnerOrgIds.length > 0
    ? loadAllRowsIn('work_items', 'organization_id', outgoingPartnerOrgIds)
    : Promise.resolve({ data: [], error: null });

  const backlogsRes = await backlogsPromise;
  if (backlogsRes.error) throw backlogsRes.error;

  // Auto-cleanup malformed (double-prefixed) tree IDs
  const malformedTreeIds = allTreeRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
  if (malformedTreeIds.length > 0) {
    supabase.from('backlog_trees').delete().in('id', malformedTreeIds).then(({ error }) => {
      if (error) console.error('cleanup malformed trees:', error);
    });
  }
  const cleanTreeRows = allTreeRows.filter(r => r.id.split('::').length <= 2);

  const backlogTrees: Record<string, BacklogTree> = {};
  for (const row of cleanTreeRows) {
    backlogTrees[row.id] = { id: row.id, name: row.name, rootBacklogIds: [], rank: row.rank, pointsEnabled: (row as { points_enabled?: boolean | null }).points_enabled ?? null };
  }

  // Auto-cleanup malformed (double-prefixed) backlog IDs
  const backlogRows = backlogsRes.data ?? [];
  const malformedBacklogIds = backlogRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
  if (malformedBacklogIds.length > 0) {
    supabase.from('backlogs').delete().in('id', malformedBacklogIds).then(({ error }) => {
      if (error) console.error('cleanup malformed backlogs:', error);
    });
  }
  const cleanBacklogRows = backlogRows.filter(r => r.id.split('::').length <= 2);

  const backlogs: Record<string, Backlog> = {};
  for (const row of cleanBacklogRows) {
    backlogs[row.id] = { id: row.id, name: row.name, parentId: row.parent_id, childrenIds: [], treeId: row.tree_id, rank: row.rank, boardHiddenStatusKeys: (row as any).board_hidden_status_keys ?? [], viewMode: ((row as any).view_mode === 'board' ? 'board' : 'list') };
  }
  for (const bl of Object.values(backlogs)) {
    if (bl.parentId && backlogs[bl.parentId]) {
      backlogs[bl.parentId].childrenIds.push(bl.id);
    } else if (!bl.parentId && backlogTrees[bl.treeId]) {
      backlogTrees[bl.treeId].rootBacklogIds.push(bl.id);
    }
  }
  for (const bl of Object.values(backlogs)) {
    bl.childrenIds.sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0));
  }
  for (const tree of Object.values(backlogTrees)) {
    tree.rootBacklogIds.sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0));
  }

  // The shell can render from here; everything below only fills in work items.
  onStructureReady?.({ backlogs, backlogTrees });

  // ── Wave 4: the heavy payloads, awaited only after the caller has painted ─
  const [ownItemsRes, incomingItemsRes, outgoingItemsRes] = await Promise.all([
    ownItemsPromise,
    incomingItemsPromise,
    outgoingItemsPromise,
  ]);
  if (ownItemsRes.error) throw ownItemsRes.error;

  let sharedWorkItems: any[] = [];
  if (incomingPartnerOrgIds.length > 0) {
    const sharedTreeIdSet = new Set(sharedTreeIds);
    sharedWorkItems = [
      ...sharedWorkItems,
      ...((incomingItemsRes.data ?? []) as any[]).filter((item) => {
        const assignments = item.backlog_assignments as Record<string, string>;
        return Object.keys(assignments).some(treeId => sharedTreeIdSet.has(treeId));
      }),
    ];
  }
  if (outgoingPartnerOrgIds.length > 0) {
    const ownTreeIdSet = new Set(ownTreeIds);
    sharedWorkItems = [
      ...sharedWorkItems,
      ...((outgoingItemsRes.data ?? []) as any[]).filter((item) => {
        const assignments = item.backlog_assignments as Record<string, string>;
        return Object.keys(assignments).some(treeId => ownTreeIdSet.has(treeId));
      }),
    ];
  }

  const itemsRes = ownItemsRes;

  const allItemRows = [...(itemsRes.data ?? []), ...sharedWorkItems];

  // Auto-cleanup malformed (double-prefixed) work item IDs
  const malformedItemIds = allItemRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
  if (malformedItemIds.length > 0) {
    supabase.from('work_items').delete().in('id', malformedItemIds).then(({ error }) => {
      if (error) console.error('cleanup malformed work items:', error);
    });
  }
  const cleanItemRows = allItemRows.filter(r => r.id.split('::').length <= 2);

  // Use the rank maps that were already fetched in parallel during Wave 1.
  // The rank fetch ran for this whole org while Waves 2 & 3 were in flight;
  // just filter it in memory to the items that survived sanitization.
  const workItemIds = new Set(cleanItemRows.map(r => r.id));
  const allRanks = await ranksPromise;
  const ranksMap = filterRanksToIds(allRanks.backlog, workItemIds);
  const boardRanksMap = filterRanksToIds(allRanks.board, workItemIds);

  // Fallback: fetch by org+item IDs in case the parallel fetch returned
  // nothing (e.g. network glitch on first attempt but data available now).
  if (Object.keys(ranksMap).length === 0 && cleanItemRows.length > 0) {
    const rankOrgIds = [
      ...new Set([
        organizationId,
        ...cleanItemRows.map(r => (r as any).organization_id).filter(Boolean),
      ]),
    ];
    Object.assign(ranksMap, await loadWorkItemBacklogRanks([...workItemIds], rankOrgIds));
    Object.assign(boardRanksMap, await loadWorkItemBoardRanks([...workItemIds], rankOrgIds));
  }

  const workItems: Record<string, WorkItem> = {};
  for (const row of cleanItemRows) {
    const r = row as any;
    const rawAssignments = (row.backlog_assignments ?? {}) as Record<string, unknown>;
    const backlogAssignments: Record<string, string> = {};
    for (const [treeId, value] of Object.entries(rawAssignments)) {
      if (typeof value === 'string') {
        backlogAssignments[treeId] = value;
      } else if (value && typeof value === 'object' && 'backlogId' in value) {
        // Legacy enriched format – extract plain backlogId
        backlogAssignments[treeId] = (value as { backlogId: string }).backlogId;
      }
    }
    const ranks = ranksMap[row.id] ?? {};
    // Fallback: if no ranks from the table, use the deprecated global rank column
    if (Object.keys(ranks).length === 0 && typeof row.rank === 'number') {
      for (const backlogId of Object.values(backlogAssignments)) {
        ranks[backlogId] = row.rank;
      }
    }
    workItems[row.id] = {
      id: row.id, title: row.title, description: row.description ?? undefined,
      points: row.points ?? undefined, status: (row.status as WorkItemStatus) ?? 'not_started',
      parentId: row.parent_id, childrenIds: [],
      parentIds: (row.parent_id_overrides && typeof row.parent_id_overrides === 'object' && !Array.isArray(row.parent_id_overrides))
        ? (row.parent_id_overrides as Record<string, string | null>)
        : undefined,
      backlogAssignments,
      ranks,
      boardRanks: boardRanksMap[row.id] ?? {},
      organizationId: row.organization_id ?? undefined,
      respawnEnabled: row.respawn_enabled ?? false,
      respawnIntervalDays: row.respawn_interval_days ?? undefined,
      respawnHour: row.respawn_hour ?? undefined,
      respawnMinute: row.respawn_minute ?? undefined,
      respawnLastTriggeredAt: row.respawn_last_triggered_at ?? undefined,
    };
  }
  for (const wi of Object.values(workItems)) {
    if (wi.parentId && workItems[wi.parentId]) {
      workItems[wi.parentId].childrenIds.push(wi.id);
    }
    // Also populate childrenIds from per-tree parent overrides so that items
    // whose parent differs by tree are still reachable from the override parent.
    if (wi.parentIds) {
      for (const treeParentId of Object.values(wi.parentIds)) {
        if (treeParentId && treeParentId !== wi.parentId && workItems[treeParentId]) {
          if (!workItems[treeParentId].childrenIds.includes(wi.id)) {
            workItems[treeParentId].childrenIds.push(wi.id);
          }
        }
      }
    }
  }
  for (const wi of Object.values(workItems)) {
    wi.childrenIds.sort((a, b) => {
      const wiA = workItems[a];
      const wiB = workItems[b];
      const rankA = wiA ? Math.min(...Object.values(wiA.ranks), 0) : 0;
      const rankB = wiB ? Math.min(...Object.values(wiB.ranks), 0) : 0;
      return rankA - rankB;
    });
  }

  // ── Repair stale org prefixes at load time ────────────────────────────────
  // Items whose ID prefix embeds a deleted/old org UUID (but whose
  // organization_id column is already correct) are renamed in the DB now so
  // the local state is clean from the start.  We do this directly instead of
  // going through repairStaleOrgPrefixes() so we can patch the in-memory map
  // without triggering the store callback (the store hasn't consumed this data
  // yet).
  const staleAtLoad = Object.values(workItems).filter(
    wi => wi.organizationId && isStalePrefix(wi.id, wi.organizationId),
  );
  if (staleAtLoad.length > 0) {
    const byOrg = new Map<string, string[]>();
    for (const wi of staleAtLoad) {
      const orgId = wi.organizationId!;
      if (!byOrg.has(orgId)) byOrg.set(orgId, []);
      byOrg.get(orgId)!.push(wi.id);
    }

    const loadOldToNew: Record<string, string> = {};
    for (const [orgId, ids] of byOrg) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc('rename_work_items_org_prefix', {
        _item_ids: ids,
        _new_org_id: orgId,
      });
      if (error) {
        console.error('loadFromSupabase: repair stale prefix failed:', error);
        continue;
      }
      Object.assign(loadOldToNew, data as Record<string, string>);
    }

    if (Object.keys(loadOldToNew).length > 0) {
      // Re-key items in the in-memory map using the new IDs.
      for (const [oldId, newId] of Object.entries(loadOldToNew)) {
        const item = workItems[oldId];
        if (!item) continue;
        workItems[newId] = {
          ...item,
          id: newId,
          parentId: item.parentId ? (loadOldToNew[item.parentId] ?? item.parentId) : null,
          childrenIds: item.childrenIds.map(cid => loadOldToNew[cid] ?? cid),
        };
        delete workItems[oldId];
      }
      // Update parentId references in items that were not themselves renamed.
      for (const item of Object.values(workItems)) {
        if (item.parentId && loadOldToNew[item.parentId]) {
          item.parentId = loadOldToNew[item.parentId];
        }
      }
    }
  }
  // ─────────────────────────────────────────────────────────────────────────

  return { workItems, backlogs, backlogTrees };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

/**
 * Callback invoked after a batch of work-item IDs has been renamed in the DB
 * so that callers (e.g. the Zustand store) can update their local state.
 * Maps old ID → new ID.
 */
export type WorkItemRenameCallback = (oldToNew: Record<string, string>) => void;
let renameCallback: WorkItemRenameCallback | null = null;

/** Register a store-level callback to be notified when work-item IDs are renamed. */
export function registerWorkItemRenameCallback(cb: WorkItemRenameCallback): void {
  renameCallback = cb;
}

/**
 * Calls the `rename_work_items_org_prefix` RPC for items whose ID prefix does
 * not match their effective `organization_id`, then notifies the registered
 * callback so the local store can update its references.
 *
 * Returns a map of old ID → new ID for all items that were renamed.
 */
async function repairStaleOrgPrefixes(
  items: Array<{ id: string; organizationId?: string }>,
  activeOrgId: string,
): Promise<Record<string, string>> {
  // Filter items whose ID prefix doesn't match their actual org.
  const stale = items.filter(item => {
    const effectiveOrg = item.organizationId ?? activeOrgId;
    return isStalePrefix(item.id, effectiveOrg);
  });
  if (stale.length === 0) return {};

  // Group by effective org (should normally all be the same org after transfer).
  const byOrg = new Map<string, string[]>();
  for (const item of stale) {
    const orgId = item.organizationId ?? activeOrgId;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(item.id);
  }

  const oldToNew: Record<string, string> = {};
  for (const [orgId, ids] of byOrg) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('rename_work_items_org_prefix', {
      _item_ids: ids,
      _new_org_id: orgId,
    });
    if (error) {
      console.error('repairStaleOrgPrefixes RPC failed:', error);
      continue;
    }
    Object.assign(oldToNew, data as Record<string, string>);
  }

  if (Object.keys(oldToNew).length > 0) {
    renameCallback?.(oldToNew);
  }
  return oldToNew;
}

// ─── Sync helpers ──────────────────────────────────────────────────────────

/**
 * Refresh the Supabase auth session and retry a DB operation once on auth errors.
 *
 * Exported for the test that pins the retry to happening even when the refresh
 * fails, which is always the case for a Clerk session.
 */
export async function withSessionRetry(
  operation: () => PromiseLike<{ error: { message?: string; code?: string } | null }>
): Promise<{ error: { message?: string; code?: string } | null }> {
  const result = await operation();
  if (!result.error) return result;

  // Only attempt a refresh + retry for auth-related errors (expired/invalid JWT, RLS violation).
  const { code, message } = result.error;
  const isAuthError =
    (code && (code.startsWith('PGRST') || code === '42501')) ||
    (message && (message.includes('JWT') || message.includes('not authenticated')));
  if (!isAuthError) return result;

  // Retrying is the whole recovery: the data client asks for a token on every
  // request and Clerk hands back a fresh one, so a second attempt carries a
  // valid token even when the first did not.
  return operation();
}

export async function upsertWorkItem(item: WorkItem, organizationId: string): Promise<boolean> {
  return enqueueWorkItemMutation(async () => upsertWorkItemImmediate(item, organizationId));
}

async function upsertWorkItemImmediate(item: WorkItem, organizationId: string): Promise<boolean> {
  const effectiveOrgId = item.organizationId ?? organizationId;

  // Only run the (potentially expensive) stale-prefix repair RPC when the
  // item's ID prefix does NOT match its effective org.  Newly-created items
  // always have the correct prefix, and items that haven't been transferred
  // between orgs do too — the common case is a no-op that saves a DB RPC.
  let resolvedId = item.id;
  if (isStalePrefix(item.id, effectiveOrgId)) {
    const oldToNew = await repairStaleOrgPrefixes([item], organizationId);
    resolvedId = oldToNew[item.id] ?? item.id;
  }

  const row: WorkItemUpsertRow = {
    id: resolvedId, title: item.title, description: item.description ?? null,
    points: item.points ?? null, status: item.status, parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments, rank: 0,
    organization_id: effectiveOrgId,
    respawn_enabled: item.respawnEnabled ?? false,
    respawn_interval_days: item.respawnIntervalDays ?? null,
    respawn_hour: item.respawnHour ?? null,
    respawn_minute: item.respawnMinute ?? null,
    respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
  };
  // Always include parent_id_overrides. Local state is the source of truth
  // (loaded from DB on fetch).  Omitting it in a batch where any other row
  // includes the column causes PostgREST to fill in NULL, which violates
  // the column's NOT NULL constraint.
  row.parent_id_overrides = item.parentIds ?? {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(row as any));
  if (error) {
    console.error('upsertWorkItem:', error, 'row:', row);
    toast({ title: 'Failed to save', description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
    return false;
  }
  notifyPersistDebug('workitem', item.title);
  // Persist per-backlog ranks to the dedicated table
  return upsertWorkItemBacklogRanks(resolvedId, item.ranks, effectiveOrgId);
}

/** Delete stale per-backlog rank rows for a set of (workItemId, backlogId) pairs. */
export async function deleteWorkItemBacklogRanks(
  pairs: Array<{ workItemId: string; backlogId: string }>,
): Promise<void> {
  if (pairs.length === 0) return;
  // Build an OR filter: each pair is (work_item_id = X AND backlog_id = Y).
  // Supabase doesn't support tuple IN directly, so we group by work_item_id.
  const byItem = new Map<string, string[]>();
  for (const { workItemId, backlogId } of pairs) {
    if (!byItem.has(workItemId)) byItem.set(workItemId, []);
    byItem.get(workItemId)!.push(backlogId);
  }
  for (const [workItemId, backlogIds] of byItem) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('work_item_backlog_ranks' as any)
      .delete()
      .eq('work_item_id', workItemId)
      .in('backlog_id', backlogIds);
    if (error) console.error('deleteWorkItemBacklogRanks:', error);
  }
}

export async function deleteWorkItems(ids: string[]) {
  if (ids.length === 0) return;
  // Also delete any double-prefixed variants that may exist in the DB
  const allIds = new Set(ids);
  ids.forEach(id => {
    const parts = id.split('::');
    if (parts.length === 2) {
      allIds.add(`${parts[0]}::${id}`);
    }
  });
  // Route through bulk_delete_work_items RPC which sets burnups.skip_history=on
  // to suppress per-row history snapshots for cascade deletes.
  const { error } = await supabase.rpc('bulk_delete_work_items', { _ids: [...allIds] });
  if (error) {
    console.error('deleteWorkItems (rpc):', error);
    // Fallback in case RPC is unavailable
    const { error: fallbackErr } = await supabase.from('work_items').delete().in('id', [...allIds]);
    if (fallbackErr) console.error('deleteWorkItems (fallback):', fallbackErr);
  }
  notifyPersistDebug('workitem', ids.length === 1 ? `Deleted` : `Deleted ${ids.length} items`);
}

export async function upsertBacklog(bl: Backlog, organizationId: string) {
  const { error } = await supabase.from('backlogs').upsert({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: safeRank(bl.rank),
    organization_id: ownerOrgOf(bl.id, organizationId),
  });
  if (error) console.error('upsertBacklog:', error);
}

export async function updateBacklogHiddenStatusKeys(backlogId: string, keys: string[]) {
  const { error } = await supabase
    .from('backlogs')
    .update({ board_hidden_status_keys: keys } as any)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogHiddenStatusKeys:', error);
}

export async function updateBacklogViewMode(backlogId: string, mode: 'list' | 'board') {
  const { error } = await supabase
    .from('backlogs')
    .update({ view_mode: mode } as any)
    .eq('id', backlogId);
  if (error) console.error('updateBacklogViewMode:', error);
}

export async function deleteBacklogs(ids: string[]) {
  if (ids.length === 0) return;
  // Also delete any double-prefixed variants that may exist in the DB
  const allIds = new Set(ids);
  ids.forEach(id => {
    const parts = id.split('::');
    if (parts.length === 2) {
      allIds.add(`${parts[0]}::${id}`);
    }
  });
  const { error } = await supabase.from('backlogs').delete().in('id', [...allIds]);
  if (error) console.error('deleteBacklogs:', error);
}

export async function upsertBacklogTree(tree: BacklogTree, organizationId: string) {
  const { error } = await supabase.from('backlog_trees').upsert({
    id: tree.id, name: tree.name, rank: safeRank(tree.rank),
    organization_id: ownerOrgOf(tree.id, organizationId),
    points_enabled: tree.pointsEnabled ?? null,
  } as never);
  if (error) console.error('upsertBacklogTree:', error);
}

export async function deleteBacklogTree(id: string) {
  // Also delete any double-prefixed variants that may exist in the DB
  const parts = id.split('::');
  const allIds = [id];
  if (parts.length === 2) {
    allIds.push(`${parts[0]}::${id}`);
  }
  const { error } = await supabase.from('backlog_trees').delete().in('id', allIds);
  if (error) console.error('deleteBacklogTree:', error);
}

export async function upsertWorkItems(items: WorkItem[], organizationId: string): Promise<boolean> {
  return enqueueWorkItemMutation(async () => upsertWorkItemsImmediate(items, organizationId));
}

async function upsertWorkItemsImmediate(items: WorkItem[], organizationId: string): Promise<boolean> {
  if (items.length === 0) return true;

  // Only call the (potentially expensive) stale-prefix repair RPC when at
  // least one item actually has a mismatched org prefix.  Newly-created
  // items always have the correct prefix, making this a no-op in the
  // common case and saving a DB RPC on every mutation.
  const anyStale = items.some(item => {
    const effectiveOrgId = item.organizationId ?? organizationId;
    return isStalePrefix(item.id, effectiveOrgId);
  });
  const oldToNew = anyStale
    ? await repairStaleOrgPrefixes(items, organizationId)
    : ({} as Record<string, string>);

  const rows: WorkItemUpsertRow[] = items.map(item => {
    const resolvedId = oldToNew[item.id] ?? item.id;
    const effectiveOrgId = item.organizationId ?? organizationId;
    const row: WorkItemUpsertRow = {
      id: resolvedId, title: item.title, description: item.description ?? null,
      points: item.points ?? null, status: item.status, parent_id: item.parentId,
      backlog_assignments: item.backlogAssignments, rank: 0,
      organization_id: effectiveOrgId,
      respawn_enabled: item.respawnEnabled ?? false,
      respawn_interval_days: item.respawnIntervalDays ?? null,
      respawn_hour: item.respawnHour ?? null,
      respawn_minute: item.respawnMinute ?? null,
      respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
    };
    // Always include parent_id_overrides — see note in upsertWorkItem.
    row.parent_id_overrides = item.parentIds ?? {};
    return row;
  });
  // Dedupe by id (last write wins) so a single upsert payload never contains
  // two rows that conflict on the same primary key — Postgres rejects those
  // with "ON CONFLICT DO UPDATE command cannot affect row a second time".
  const dedupedById = new Map<string, WorkItemUpsertRow>();
  for (const row of rows) dedupedById.set(row.id, row);
  const dedupedRows = Array.from(dedupedById.values());
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(dedupedRows as any));
  if (error) {
    console.error('upsertWorkItems:', error, 'rows:', dedupedRows);
    toast({ title: 'Failed to save', description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
    return false;
  }
  notifyPersistDebug('workitem', items.length === 1 ? items[0].title : `${items.length} items`);
  // Persist per-backlog ranks to the dedicated table
  return upsertWorkItemBacklogRanksBatch(items, oldToNew, organizationId);
}

export async function upsertBacklogs(bls: Backlog[], organizationId: string) {
  if (bls.length === 0) return;
  const rows = bls.map(bl => ({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: safeRank(bl.rank),
    organization_id: ownerOrgOf(bl.id, organizationId),
  }));
  const { error } = await supabase.from('backlogs').upsert(rows);
  if (error) console.error('upsertBacklogs:', error);
}

export async function upsertBacklogTrees(trees: BacklogTree[], organizationId: string) {
  if (trees.length === 0) return;
  const rows = trees.map(t => ({
    id: t.id, name: t.name, rank: safeRank(t.rank),
    organization_id: ownerOrgOf(t.id, organizationId),
    points_enabled: t.pointsEnabled ?? null,
  }));
  const { error } = await supabase.from('backlog_trees').upsert(rows as never);
  if (error) console.error('upsertBacklogTrees:', error);
}

type MockDataSnapshot = {
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
};

function scopeMockDataToOrganization(organizationId: string, mockData: MockDataSnapshot): MockDataSnapshot {
  const prefix = `${organizationId}::`;

  const treeIdMap = Object.fromEntries(
    Object.keys(mockData.backlogTrees).map((id) => [id, `${prefix}${id}`])
  ) as Record<string, string>;

  const backlogIdMap = Object.fromEntries(
    Object.keys(mockData.backlogs).map((id) => [id, `${prefix}${id}`])
  ) as Record<string, string>;

  const workItemIdMap = Object.fromEntries(
    Object.keys(mockData.workItems).map((id) => [id, `${prefix}${id}`])
  ) as Record<string, string>;

  const backlogTrees = Object.fromEntries(
    Object.values(mockData.backlogTrees).map((tree) => {
      const nextId = treeIdMap[tree.id];
      return [
        nextId,
        {
          ...tree,
          id: nextId,
          rootBacklogIds: tree.rootBacklogIds.map((id) => backlogIdMap[id]),
        },
      ];
    })
  );

  const backlogs = Object.fromEntries(
    Object.values(mockData.backlogs).map((backlog) => {
      const nextId = backlogIdMap[backlog.id];
      return [
        nextId,
        {
          ...backlog,
          id: nextId,
          parentId: backlog.parentId ? backlogIdMap[backlog.parentId] : null,
          childrenIds: backlog.childrenIds.map((id) => backlogIdMap[id]),
          treeId: treeIdMap[backlog.treeId],
        },
      ];
    })
  );

  const workItems = Object.fromEntries(
    Object.values(mockData.workItems).map((item) => {
      const nextId = workItemIdMap[item.id];
      return [
        nextId,
        {
          ...item,
          id: nextId,
          parentId: item.parentId ? workItemIdMap[item.parentId] : null,
          childrenIds: item.childrenIds.map((id) => workItemIdMap[id]),
          backlogAssignments: Object.fromEntries(
            Object.entries(item.backlogAssignments).map(([treeId, backlogId]) => [
              treeIdMap[treeId],
              backlogIdMap[backlogId],
            ])
          ),
          ranks: Object.fromEntries(
            Object.entries(item.ranks).map(([backlogId, rank]) => [
              backlogIdMap[backlogId] ?? backlogId,
              rank,
            ])
          ),
        },
      ];
    })
  );

  return { workItems, backlogs, backlogTrees };
}

export async function resetOrgData(organizationId: string, mockData: MockDataSnapshot) {
  const scopedMockData = scopeMockDataToOrganization(organizationId, mockData);

  // Delete ranks first (FK to work_items)
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  await supabase.from('work_item_backlog_ranks' as any).delete().eq('organization_id', organizationId);

  const { error: deleteItemsError } = await supabase
    .from('work_items')
    .delete()
    .eq('organization_id', organizationId);
  if (deleteItemsError) throw deleteItemsError;

  const { error: deleteBacklogsError } = await supabase
    .from('backlogs')
    .delete()
    .eq('organization_id', organizationId);
  if (deleteBacklogsError) throw deleteBacklogsError;

  const { error: deleteTreesError } = await supabase
    .from('backlog_trees')
    .delete()
    .eq('organization_id', organizationId);
  if (deleteTreesError) throw deleteTreesError;

  const treeRows = Object.values(scopedMockData.backlogTrees).map((tree) => ({
    id: tree.id,
    name: tree.name,
    rank: safeRank(tree.rank),
    organization_id: organizationId,
  }));
  if (treeRows.length > 0) {
    const { error } = await supabase.from('backlog_trees').insert(treeRows);
    if (error) throw error;
  }

  const backlogRows = Object.values(scopedMockData.backlogs).map((backlog) => ({
    id: backlog.id,
    name: backlog.name,
    parent_id: backlog.parentId,
    tree_id: backlog.treeId,
    rank: safeRank(backlog.rank),
    organization_id: organizationId,
  }));
  if (backlogRows.length > 0) {
    const { error } = await supabase.from('backlogs').insert(backlogRows);
    if (error) throw error;
  }

  const itemRows = Object.values(scopedMockData.workItems).map((item) => ({
    id: item.id,
    title: item.title,
    description: item.description ?? null,
    points: item.points ?? null,
    status: item.status,
    parent_id: item.parentId,
    parent_id_overrides: item.parentIds ?? {},
    backlog_assignments: item.backlogAssignments,
    rank: 0,
    organization_id: organizationId,
  }));
  if (itemRows.length > 0) {
    const { error } = await supabase.from('work_items').insert(itemRows);
    if (error) throw error;
  }

  // Insert per-backlog ranks
  const rankRows: Array<{ work_item_id: string; backlog_id: string; rank: number; organization_id: string }> = [];
  for (const item of Object.values(scopedMockData.workItems)) {
    for (const [backlogId, rank] of Object.entries(item.ranks)) {
      rankRows.push({
        work_item_id: item.id,
        backlog_id: backlogId,
        rank: safeRank(rank),
        organization_id: organizationId,
      });
    }
  }
  if (rankRows.length > 0) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase.from('work_item_backlog_ranks' as any).insert(rankRows);
    if (error) throw error;
  }
}

/** Filter a rank map to only include entries whose key is in `ids`. */
function filterRanksToIds(map: Record<string, Record<string, number>>, ids: Set<string>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, ranks] of Object.entries(map)) {
    if (ids.has(id)) out[id] = ranks;
  }
  return out;
}

// ─── Optimised org-scoped rank fetchers (run in parallel with Wave 1) ────

type RankMaps = {
  backlog: Record<string, Record<string, number>>;
  board: Record<string, Record<string, number>>;
};

/**
 * Fetch both rank maps in a single request.
 *
 * The rank tables are the largest thing read on cold start by row count, and
 * almost all of it was repetition: ~10 400 rows referencing only ~54 distinct
 * backlogs, each row restating an org-prefixed work_item_id and backlog_id.
 * `get_work_item_ranks` groups them by work item and interns the backlog ids,
 * which is the same data at roughly a third of the bytes.
 *
 * Returns null if the RPC is unavailable — an older deployment, or the
 * migration not yet applied — so the caller can fall back to reading the
 * tables directly.
 */
async function fetchRanksGrouped(orgIds: string[]): Promise<RankMaps | null> {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await (supabase as any).rpc('get_work_item_ranks', { _org_ids: orgIds });
  if (error || !data) {
    if (error) console.warn('get_work_item_ranks unavailable, falling back to row reads:', error);
    return null;
  }
  const payload = data as {
    backlogIds?: string[];
    backlog?: Record<string, Record<string, number>>;
    board?: Record<string, Record<string, number>>;
  };
  const backlogIds = payload.backlogIds ?? [];
  const expand = (grouped?: Record<string, Record<string, number>>) => {
    const out: Record<string, Record<string, number>> = {};
    for (const [workItemId, byIndex] of Object.entries(grouped ?? {})) {
      const ranks: Record<string, number> = {};
      for (const [index, rank] of Object.entries(byIndex)) {
        const backlogId = backlogIds[Number(index)];
        if (backlogId !== undefined) ranks[backlogId] = rank ?? 0;
      }
      out[workItemId] = ranks;
    }
    return out;
  };
  return { backlog: expand(payload.backlog), board: expand(payload.board) };
}

/** Both rank maps for an org, grouped in one request where possible. */
async function fetchAllRanksForOrg(orgId: string): Promise<RankMaps> {
  const grouped = await fetchRanksGrouped([orgId]);
  if (grouped) return grouped;
  const [backlog, board] = await Promise.all([
    fetchRanksByOrg(orgId),
    fetchBoardRanksByOrg(orgId),
  ]);
  return { backlog, board };
}

/** Fetch all backlog ranks for an org — used during load to overlap I/O. */
async function fetchRanksByOrg(orgId: string): Promise<Record<string, Record<string, number>>> {
  const wanted = new Set<string>();
  const result: Record<string, Record<string, number>> = {};
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('work_item_backlog_ranks' as any)
      .select(RANK_COLUMNS)
      .in('organization_id', [orgId])
      .order('work_item_id', { ascending: true })
      .order('backlog_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetchRanksByOrg:', error); return {}; }
    const rows = (data ?? []) as any[];
    for (const row of rows) {
      const wiId = row.work_item_id as string;
      if (!result[wiId]) result[wiId] = {};
      result[wiId][row.backlog_id as string] = (row.rank as number) ?? 0;
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

/** Fetch all board ranks for an org — used during load to overlap I/O. */
async function fetchBoardRanksByOrg(orgId: string): Promise<Record<string, Record<string, number>>> {
  const result: Record<string, Record<string, number>> = {};
  const PAGE = 1000;
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from('work_item_board_ranks' as any)
      .select(RANK_COLUMNS)
      .in('organization_id', [orgId])
      .order('work_item_id', { ascending: true })
      .order('backlog_id', { ascending: true })
      .range(from, from + PAGE - 1);
    if (error) { console.error('fetchBoardRanksByOrg:', error); return {}; }
    const rows = (data ?? []) as any[];
    for (const row of rows) {
      const wiId = row.work_item_id as string;
      if (!result[wiId]) result[wiId] = {};
      result[wiId][row.backlog_id as string] = (row.rank as number) ?? 0;
    }
    if (rows.length < PAGE) break;
    from += PAGE;
  }
  return result;
}

// ─── Work Item Backlog Ranks CRUD ─────────────────────────────────────────

/** Load per-backlog ranks for a set of work items from the work_item_backlog_ranks table.
 *  When `organizationIds` is provided, fetches by org and filters in memory –
 *  this avoids PostgREST URL length limits triggered by large `.in('work_item_id', ...)`
 *  lists, which would silently return zero rows. */
async function loadWorkItemBacklogRanks(
  workItemIds: string[],
  organizationIds?: string[],
): Promise<Record<string, Record<string, number>>> {
  if (workItemIds.length === 0) return {};
  const wanted = new Set(workItemIds);
  const result: Record<string, Record<string, number>> = {};

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (rows: any[]) => {
    for (const row of rows) {
      const wiId = row.work_item_id as string;
      if (!wanted.has(wiId)) continue;
      if (!result[wiId]) result[wiId] = {};
      result[wiId][row.backlog_id as string] = (row.rank as number) ?? 0;
    }
  };

  if (organizationIds && organizationIds.length > 0) {
    // Paginate to bypass PostgREST's default 1000-row cap. Large orgs can
    // easily have thousands of rank rows; without pagination some ranks are
    // silently dropped and the fallback to the deprecated work_items.rank
    // column shuffles items into an apparently-random order on reload.
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from('work_item_backlog_ranks' as any)
        .select(RANK_COLUMNS)
        .in('organization_id', organizationIds)
        .order('work_item_id', { ascending: true })
        .order('backlog_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { console.error('loadWorkItemBacklogRanks:', error); return {}; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];
      collect(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return result;
  }

  // Fallback: chunk by work_item_id to stay under URL limits.
  const CHUNK = 100;
  for (let i = 0; i < workItemIds.length; i += CHUNK) {
    const chunk = workItemIds.slice(i, i + CHUNK);
    // Paginate inside the chunk: a hot work item could still exceed 1k ranks.
    const { data, error } = await paginateSelect<any>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('work_item_backlog_ranks' as any).select(RANK_COLUMNS) as any)
        .in('work_item_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (error) { console.error('loadWorkItemBacklogRanks:', error); return {}; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collect((data ?? []) as any[]);
  }
  return result;
}

/** Upsert per-backlog ranks for a single work item. */
async function upsertWorkItemBacklogRanks(
  workItemId: string,
  ranks: Record<string, number>,
  organizationId: string,
): Promise<boolean> {
  const rows = Object.entries(ranks).map(([backlogId, rank]) => ({ workItemId, backlogId, rank, organizationId }));
  return upsertWorkItemBacklogRankRowsImmediate(rows);
}

export async function upsertWorkItemBacklogRankRows(
  rowsToUpsert: WorkItemBacklogRankUpsert[],
): Promise<boolean> {
  return (await upsertWorkItemBacklogRankRowsDetailed(rowsToUpsert)).ok;
}

/** What a rank write achieved, for callers that keep a retry queue. */
export interface RankUpsertResult {
  /** Every row was written, or skipped because its work item does not exist. */
  ok: boolean;
  /**
   * Work items the rows named that are not in the database, so their rows were
   * not written. Either deleted — the rank is moot — or not inserted yet; only
   * the caller can tell which, from what it still holds locally.
   */
  missingWorkItemIds: string[];
}

type RankRow = { work_item_id: string; backlog_id: string; rank: number; organization_id: string };

/** Of these work item ids, the ones the database has. Null if it cannot say. */
async function existingWorkItemIds(ids: string[]): Promise<Set<string> | null> {
  const found = new Set<string>();
  const unique = [...new Set(ids)];
  for (let i = 0; i < unique.length; i += 200) {
    const chunk = unique.slice(i, i + 200);
    // Never more than 200 rows, by primary key, but paginated all the same:
    // reads from work_items go through the shared helper, which is what the
    // pagination guard checks for.
    const { data, error } = await paginateSelect<{ id: string }>((from, to) =>
      supabase.from('work_items').select('id').in('id', chunk).order('id', { ascending: true }).range(from, to),
    );
    if (error) return null;
    for (const row of data ?? []) found.add(row.id);
  }
  return found;
}

/**
 * Upsert rank rows, surviving rows whose work item no longer exists.
 *
 * Both rank tables reference work_items, so a single row for a deleted item
 * made the whole payload fail — and because failed writes stay in the retry
 * queue and are re-sent on every load, that one row failed every write after
 * it too, showing "Failed to save ranking" again and again. A rank for an item
 * that is gone has nothing left to order, so on that one error the rows are
 * checked, the rest are written, and the missing items are reported rather
 * than treated as a failure.
 *
 * The check costs nothing on the normal path: it runs only after the database
 * has already refused the write for exactly this reason.
 */
async function upsertRankRowsSkippingMissing(
  table: 'work_item_backlog_ranks' | 'work_item_board_ranks',
  rows: RankRow[],
  failureTitle: string,
): Promise<RankUpsertResult> {
  if (rows.length === 0) return { ok: true, missingWorkItemIds: [] };
  // Sort by (work_item_id, backlog_id) so concurrent upserts always acquire
  // row locks in the same order, preventing PostgreSQL deadlocks.
  rows.sort((a, b) => a.work_item_id < b.work_item_id ? -1 : a.work_item_id > b.work_item_id ? 1 : a.backlog_id < b.backlog_id ? -1 : a.backlog_id > b.backlog_id ? 1 : 0);

  const write = async (payload: RankRow[]) =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (await supabase.from(table as any).upsert(payload, { onConflict: 'work_item_id,backlog_id' })).error;

  let error = await write(rows);
  let missing: string[] = [];
  // 23503 is foreign_key_violation. The constraint name is checked too, so a
  // foreign key added to these tables later is not mistaken for this one.
  if (error?.code === '23503' && /work_item_id_fkey/.test(error.message ?? '')) {
    const existing = await existingWorkItemIds(rows.map((r) => r.work_item_id));
    if (existing) {
      missing = [...new Set(rows.filter((r) => !existing.has(r.work_item_id)).map((r) => r.work_item_id))];
      const writable = rows.filter((r) => existing.has(r.work_item_id));
      error = writable.length > 0 ? await write(writable) : null;
    }
  }

  if (error) {
    console.error(`upsert ${table}:`, error);
    toast({ title: failureTitle, description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
    return { ok: false, missingWorkItemIds: missing };
  }
  if (missing.length > 0) {
    console.warn(`upsert ${table}: skipped ranks for ${missing.length} work item(s) not in the database`, missing);
  }
  return { ok: true, missingWorkItemIds: missing };
}

export async function upsertWorkItemBacklogRankRowsDetailed(
  rowsToUpsert: WorkItemBacklogRankUpsert[],
): Promise<RankUpsertResult> {
  return upsertRankRowsSkippingMissing(
    'work_item_backlog_ranks',
    rowsToUpsert.map((row) => ({
      work_item_id: row.workItemId,
      backlog_id: row.backlogId,
      rank: safeRank(row.rank),
      organization_id: row.organizationId,
    })),
    'Failed to save ranking',
  );
}

async function upsertWorkItemBacklogRankRowsImmediate(
  rowsToUpsert: WorkItemBacklogRankUpsert[],
): Promise<boolean> {
  return (await upsertWorkItemBacklogRankRowsDetailed(rowsToUpsert)).ok;
}

/** Upsert per-backlog ranks for a batch of work items. */
async function upsertWorkItemBacklogRanksBatch(
  items: WorkItem[],
  oldToNew: Record<string, string>,
  organizationId: string,
): Promise<boolean> {
  const rows: Array<{ work_item_id: string; backlog_id: string; rank: number; organization_id: string }> = [];
  for (const item of items) {
    const resolvedId = oldToNew[item.id] ?? item.id;
    const effectiveOrgId = item.organizationId ?? organizationId;
    for (const [backlogId, rank] of Object.entries(item.ranks)) {
      rows.push({
        work_item_id: resolvedId,
        backlog_id: backlogId,
        rank: safeRank(rank),
        organization_id: effectiveOrgId,
      });
    }
  }
  if (rows.length === 0) return true;
  // Dedupe by (work_item_id, backlog_id) so a single payload never has two
  // rows targeting the same conflict key (would raise "cannot affect row a
  // second time"). Last write wins.
  const dedup = new Map<string, typeof rows[number]>();
  for (const r of rows) dedup.set(`${r.work_item_id}::${r.backlog_id}`, r);
  const deduped = Array.from(dedup.values());
  // Sort by (work_item_id, backlog_id) so concurrent upserts always acquire
  // row locks in the same order, preventing PostgreSQL deadlocks.
  deduped.sort((a, b) => a.work_item_id < b.work_item_id ? -1 : a.work_item_id > b.work_item_id ? 1 : a.backlog_id < b.backlog_id ? -1 : a.backlog_id > b.backlog_id ? 1 : 0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase
    .from('work_item_backlog_ranks' as any)
    .upsert(deduped, { onConflict: 'work_item_id,backlog_id' });
  if (error) {
    console.error('upsertWorkItemBacklogRanksBatch:', error);
    toast({ title: 'Failed to save ranking', description: error.message || 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
    return false;
  }
  return true;
}

// ─── Work Item Board Ranks CRUD (independent from list ranks) ─────────────

async function loadWorkItemBoardRanks(
  workItemIds: string[],
  organizationIds?: string[],
): Promise<Record<string, Record<string, number>>> {
  if (workItemIds.length === 0) return {};
  const wanted = new Set(workItemIds);
  const result: Record<string, Record<string, number>> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const collect = (rows: any[]) => {
    for (const row of rows) {
      const wiId = row.work_item_id as string;
      if (!wanted.has(wiId)) continue;
      if (!result[wiId]) result[wiId] = {};
      result[wiId][row.backlog_id as string] = (row.rank as number) ?? 0;
    }
  };
  if (organizationIds && organizationIds.length > 0) {
    const PAGE = 1000;
    let from = 0;
    for (;;) {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await supabase
        .from('work_item_board_ranks' as any)
        .select(RANK_COLUMNS)
        .in('organization_id', organizationIds)
        .order('work_item_id', { ascending: true })
        .order('backlog_id', { ascending: true })
        .range(from, from + PAGE - 1);
      if (error) { console.error('loadWorkItemBoardRanks:', error); return {}; }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const rows = (data ?? []) as any[];
      collect(rows);
      if (rows.length < PAGE) break;
      from += PAGE;
    }
    return result;
  }
  const CHUNK = 100;
  for (let i = 0; i < workItemIds.length; i += CHUNK) {
    const chunk = workItemIds.slice(i, i + CHUNK);
    const { data, error } = await paginateSelect<any>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('work_item_board_ranks' as any).select(RANK_COLUMNS) as any)
        .in('work_item_id', chunk)
        .order('id', { ascending: true })
        .range(from, to),
    );
    if (error) { console.error('loadWorkItemBoardRanks:', error); return {}; }
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    collect((data ?? []) as any[]);
  }
  return result;
}

export async function upsertWorkItemBoardRankRows(
  rowsToUpsert: WorkItemBoardRankUpsert[],
): Promise<boolean> {
  return (await upsertWorkItemBoardRankRowsDetailed(rowsToUpsert)).ok;
}

/** Board ranks reference work_items the same way, and queue the same way. */
export async function upsertWorkItemBoardRankRowsDetailed(
  rowsToUpsert: WorkItemBoardRankUpsert[],
): Promise<RankUpsertResult> {
  return upsertRankRowsSkippingMissing(
    'work_item_board_ranks',
    rowsToUpsert.map((row) => ({
      work_item_id: row.workItemId,
      backlog_id: row.backlogId,
      rank: safeRank(row.rank),
      organization_id: row.organizationId,
    })),
    'Failed to save board ranking',
  );
}

export async function deleteWorkItemBoardRanks(
  pairs: Array<{ workItemId: string; backlogId: string }>,
): Promise<void> {
  if (pairs.length === 0) return;
  const byItem = new Map<string, string[]>();
  for (const { workItemId, backlogId } of pairs) {
    if (!byItem.has(workItemId)) byItem.set(workItemId, []);
    byItem.get(workItemId)!.push(backlogId);
  }
  for (const [workItemId, backlogIds] of byItem) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await supabase
      .from('work_item_board_ranks' as any)
      .delete()
      .eq('work_item_id', workItemId)
      .in('backlog_id', backlogIds);
    if (error) console.error('deleteWorkItemBoardRanks:', error);
  }
}


export async function loadHyperlinksForWorkItems(
  workItemIds: string[],
  organizationId?: string,
): Promise<Record<string, Hyperlink[]>> {
  // When an organizationId is supplied we can fetch every hyperlink for that
  // org in a single query — no work-item id list required.  This enables
  // callers to start the hyperlinks fetch in parallel with the main data load.
  if (workItemIds.length === 0 && !organizationId) return {};
  // Prefer a single org-scoped fetch — passing hundreds of IDs via `.in()`
  // builds a URL that exceeds PostgREST's request size limit and returns nothing.
  // Fall back to chunked `.in()` queries when no org is provided.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  let data: any[] | null = null;
  let error: unknown = null;
  if (organizationId) {
    // Paginate: an org with many links can easily exceed the 1000-row cap.
    const res = await paginateSelect<Record<string, unknown>>((from, to) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (supabase.from('work_item_hyperlinks' as any).select(HYPERLINK_COLUMNS) as any)
        .eq('organization_id', organizationId)
        .order('rank', { ascending: true })
        .order('id', { ascending: true })
        .range(from, to),
    );
    data = res.data as any[] | null;
    error = res.error;
    if (data && workItemIds.length > 0) {
      const idSet = new Set(workItemIds);
      data = data.filter((row) => idSet.has(row.work_item_id));
    }



  } else {
    const CHUNK = 100;
    const collected: any[] = [];
    for (let i = 0; i < workItemIds.length; i += CHUNK) {
      const slice = workItemIds.slice(i, i + CHUNK);
      const res = await paginateSelect<any>((from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('work_item_hyperlinks' as any).select(HYPERLINK_COLUMNS) as any)
          .in('work_item_id', slice)
          .order('rank', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      if (res.error) { error = res.error; break; }
      if (res.data) collected.push(...(res.data as any[]));
    }
    if (!error) data = collected;
  }
  if (error) { console.error('loadHyperlinksForWorkItems:', error); return {}; }
  const result: Record<string, Hyperlink[]> = {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  for (const row of (data ?? []) as any[]) {
    const link: Hyperlink = {
      id: row.id,
      workItemId: row.work_item_id,
      url: row.url,
      altText: row.alt_text ?? '',
      rank: row.rank ?? 0,
    };
    if (!result[link.workItemId]) result[link.workItemId] = [];
    result[link.workItemId].push(link);
  }
  return result;
}

export async function upsertHyperlink(link: Hyperlink, organizationId: string, itemOrgId?: string) {
  // Prefer the item's stored organization_id (passed by the caller) so we never
  // try to assign a hyperlink to a deleted org derived from a stale ID prefix.
  const effectiveOrgId = itemOrgId ?? ownerOrgOf(link.workItemId, organizationId);

  // If the work item has a stale prefix, rename it first so the FK for
  // work_item_id stays valid after the repair.
  const oldToNew = await repairStaleOrgPrefixes(
    [{ id: link.workItemId, organizationId: itemOrgId }],
    organizationId,
  );
  const resolvedWorkItemId = oldToNew[link.workItemId] ?? link.workItemId;

  const row = {
    id: link.id,
    work_item_id: resolvedWorkItemId,
    url: link.url,
    alt_text: link.altText,
    rank: safeRank(link.rank),
    organization_id: effectiveOrgId,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_item_hyperlinks' as any).upsert(row as any).select().then(r => r));
  if (error) {
    console.error('upsertHyperlink:', error);
    toast({ title: 'Failed to save hyperlink', description: 'Please check your connection and try again.', variant: 'destructive' });
  }
}

export async function deleteHyperlink(id: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await supabase.from('work_item_hyperlinks' as any).delete().eq('id', id);
  if (error) console.error('deleteHyperlink:', error);
}
