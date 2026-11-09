/**
 * Loading from Supabase: an organization's trees, lists, items, ranks and
 * links, a few large reads at a time. Taken out of supabaseSync.ts word for
 * word.
 */
import { supabase } from '@/integrations/supabase/client';
import { paginateSelect } from '@/integrations/supabase/pagination';
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink } from '@/types/models';
import { loadOrgRows, type FullReads, type HyperlinkRow } from '../rowMirror';
import { isStalePrefix, RANK_COLUMNS, HYPERLINK_COLUMNS, withStallRetry, type SupabaseReadResult, type PageResult } from "./common";

/**
 * The large reads of a load allowed at once, across every table. The database
 * has 406 MB of memory and keeps as much again in swap. All of a load's pages at
 * once pushed it into waiting on swap (IOwait to 72%), where a read that takes a
 * third of a second took twenty and everything else in the app timed out —
 * for minutes, and longer as failed reads were asked for again.
 */
export const LARGE_READS_AT_ONCE = 2;

export let largeReadsRunning = 0;

export const largeReadsWaiting: Array<() => void> = [];

/** A large read, when its turn comes. */
export async function largeRead<T>(read: () => PromiseLike<T>): Promise<T> {
  if (largeReadsRunning >= LARGE_READS_AT_ONCE) {
    await new Promise<void>((resolve) => largeReadsWaiting.push(resolve));
  } else {
    largeReadsRunning += 1;
  }
  try {
    return await read();
  } finally {
    // The turn passes straight to the next in line, or is given up.
    const next = largeReadsWaiting.shift();
    if (next) next();
    else largeReadsRunning -= 1;
  }
}

/**
 * Every row of a query the server hands out a thousand at a time.
 *
 * The pages used to be asked for one after another: an organization of a few
 * thousand items waited four round trips in a row before it had its items,
 * which on a phone is most of what a start costs. The first page now asks how
 * many rows there are in all, and the rest are fetched side by side, as many
 * at once as LARGE_READS_AT_ONCE allows.
 *
 * `page(from, to, counted)` runs the query for those rows, with the total
 * asked for when `counted`. Where no total comes back the pages are read in
 * turn, as before; and a last page that still comes back full — the table
 * grew while it was being read — is followed until one does not.
 */
export async function loadPagesSideBySide(
  page: (from: number, to: number, counted: boolean) => PromiseLike<PageResult>,
  PAGE = 1000,
): Promise<SupabaseReadResult> {
  const first = await largeRead(() => page(0, PAGE - 1, true));
  if (first.error) return { data: null, error: first.error };
  const rows: any[] = [...(first.data ?? [])];
  let last = first.data ?? [];
  let from = PAGE;

  if (last.length === PAGE && typeof first.count === 'number' && first.count > PAGE) {
    const starts: number[] = [];
    for (let start = PAGE; start < first.count; start += PAGE) starts.push(start);
    const rest = await Promise.all(starts.map((start) => largeRead(() => page(start, start + PAGE - 1, false))));
    for (const result of rest) {
      if (result.error) return { data: null, error: result.error };
      rows.push(...(result.data ?? []));
    }
    last = rest[rest.length - 1].data ?? [];
    from = PAGE + starts.length * PAGE;
  }

  while (last.length === PAGE) {
    const next = await largeRead(() => page(from, from + PAGE - 1, false));
    if (next.error) return { data: null, error: next.error };
    last = next.data ?? [];
    rows.push(...last);
    from += PAGE;
  }
  return { data: rows, error: null };
}

export async function loadAllRows(table: string, column: string, value: string): Promise<SupabaseReadResult> {
  return loadPagesSideBySide((from, to, counted) =>
    supabase
      .from(table as any)
      .select('*', counted ? { count: 'exact' } : undefined)
      .eq(column, value)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

export async function loadAllRowsIn(table: string, column: string, values: string[]): Promise<SupabaseReadResult> {
  if (values.length === 0) return { data: [], error: null };
  return loadPagesSideBySide((from, to, counted) =>
    supabase
      .from(table as any)
      .select('*', counted ? { count: 'exact' } : undefined)
      .in(column, values)
      .order('id', { ascending: true })
      .range(from, to),
  );
}

export type OutgoingShares = { data: Array<{ organization_id: string; tree_id: string }> | null; error: unknown };

export let outgoingShares: { key: string; at: number; promise: Promise<OutgoingShares> } | null = null;

/** How long one read of them serves everyone who asks. */
export const OUTGOING_SHARES_REUSE_MS = 10_000;

/**
 * The organizations our trees are shared with. A load reads them, and so does
 * the live-update hook, to listen to those organizations too — a couple of
 * seconds apart, the same rows. One read now serves both, for a few seconds;
 * a share added or removed forgets it (forgetOutgoingShares).
 */
export function readOutgoingShares(treeIds: readonly string[]): Promise<OutgoingShares> {
  const key = [...treeIds].sort().join(',');
  if (outgoingShares && outgoingShares.key === key && Date.now() - outgoingShares.at < OUTGOING_SHARES_REUSE_MS) {
    return outgoingShares.promise;
  }
  const promise = Promise.resolve(
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (supabase.from('backlog_tree_shares' as any).select('organization_id, tree_id') as any).in('tree_id', [...treeIds]),
  ).then((res: OutgoingShares) => {
    if (res.error && outgoingShares?.promise === promise) outgoingShares = null;
    return res;
  });
  outgoingShares = { key, at: Date.now(), promise };
  return promise;
}

export function forgetOutgoingShares(): void {
  outgoingShares = null;
}

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
  // The org's own items and ranks — and its links, asked for by the caller at
  // the same moment — in one request for what changed, where the browser has
  // them already (rowMirror.ts).
  const ownRowsPromise = loadOrgRows(organizationId, fullReadsFor(organizationId));
  const ownItemsPromise: Promise<SupabaseReadResult> = ownRowsPromise.then(
    (rows) => ({ data: rows.items as any[], error: null }),
    (error) => ({ data: null, error }),
  );
  const ranksPromise: Promise<RankMaps> = ownRowsPromise.then(
    (rows) => rows.ranks,
    () => ({ backlog: {}, board: {} }),
  );

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
    ? readOutgoingShares(ownTreeIds)
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
    backlogs[row.id] = { id: row.id, name: row.name, parentId: row.parent_id, childrenIds: [], treeId: row.tree_id, rank: row.rank, boardHiddenStatusKeys: (row as any).board_hidden_status_keys ?? [], viewMode: ((row as any).view_mode === 'board' ? 'board' : (row as any).view_mode === 'timeline' ? 'timeline' : 'list'), ratingsEnabled: (row as { ratings_enabled?: boolean | null }).ratings_enabled === true, createdDatesEnabled: (row as { created_dates_enabled?: boolean | null }).created_dates_enabled === true, startEndDatesEnabled: (row as { start_end_dates_enabled?: boolean | null }).start_end_dates_enabled === true, points: (row as { points?: number | null }).points ?? undefined };
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
      points: row.points ?? undefined, rating: (row as { rating?: number | null }).rating ?? undefined, deadline: (row as { deadline?: string | null }).deadline ?? undefined, createdOn: (row as { created_on?: string | null }).created_on ?? undefined, startedOn: (row as { started_on?: string | null }).started_on ?? undefined, endedOn: (row as { ended_on?: string | null }).ended_on ?? undefined, status: (row.status as WorkItemStatus) ?? 'not_started',
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
      changedAt: (row as { changed_at?: string | null }).changed_at ?? undefined,
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

/** Filter a rank map to only include entries whose key is in `ids`. */
export function filterRanksToIds(map: Record<string, Record<string, number>>, ids: Set<string>): Record<string, Record<string, number>> {
  const out: Record<string, Record<string, number>> = {};
  for (const [id, ranks] of Object.entries(map)) {
    if (ids.has(id)) out[id] = ranks;
  }
  return out;
}

export type RankMaps = {
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
 * tables directly. A database too busy to answer is asked again first: reading
 * the tables is far more work, and it is the last thing a stalled database needs.
 */
export async function fetchRanksGrouped(orgIds: string[]): Promise<RankMaps | null> {
  const { data, error } = await withStallRetry(() =>
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    largeRead(() => (supabase as any).rpc('get_work_item_ranks', { _org_ids: orgIds }) as PromiseLike<{ data: any; error: any }>),
  );
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

/** How the org's kept rows are read in full, when they cannot just be brought up to date. */
export function fullReadsFor(organizationId: string): FullReads {
  return {
    items: async () => {
      const res = await loadAllRows('work_items', 'organization_id', organizationId);
      if (res.error) throw res.error;
      return (res.data ?? []) as Record<string, unknown>[];
    },
    ranks: () => fetchAllRanksForOrg(organizationId),
    hyperlinks: async () => {
      const res = await paginateSelect<HyperlinkRow>((from, to) =>
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        (supabase.from('work_item_hyperlinks' as any).select(HYPERLINK_COLUMNS) as any)
          .eq('organization_id', organizationId)
          .order('rank', { ascending: true })
          .order('id', { ascending: true })
          .range(from, to),
      );
      if (res.error) throw res.error;
      return (res.data ?? []) as HyperlinkRow[];
    },
  };
}

/** Both rank maps for an org, grouped in one request where possible. */
export async function fetchAllRanksForOrg(orgId: string): Promise<RankMaps> {
  const grouped = await fetchRanksGrouped([orgId]);
  if (grouped) return grouped;
  const [backlog, board] = await Promise.all([
    fetchRanksByOrg(orgId),
    fetchBoardRanksByOrg(orgId),
  ]);
  return { backlog, board };
}

/** Fetch all backlog ranks for an org — used during load to overlap I/O. */
export async function fetchRanksByOrg(orgId: string): Promise<Record<string, Record<string, number>>> {
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
export async function fetchBoardRanksByOrg(orgId: string): Promise<Record<string, Record<string, number>>> {
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

/** Load per-backlog ranks for a set of work items from the work_item_backlog_ranks table.
 *  When `organizationIds` is provided, fetches by org and filters in memory –
 *  this avoids PostgREST URL length limits triggered by large `.in('work_item_id', ...)`
 *  lists, which would silently return zero rows. */
export async function loadWorkItemBacklogRanks(
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

export async function loadWorkItemBoardRanks(
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
    // With the org's items and ranks: only what changed, where the browser has the rest.
    try {
      data = (await loadOrgRows(organizationId, fullReadsFor(organizationId))).hyperlinks;
    } catch (err) {
      error = err;
    }
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
