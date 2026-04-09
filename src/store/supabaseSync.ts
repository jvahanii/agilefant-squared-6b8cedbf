import { supabase } from '@/integrations/supabase/client';
import { WorkItem, WorkItemStatus, Backlog, BacklogTree, Hyperlink } from '@/types/models';
import { toast } from '@/hooks/use-toast';

/** Ensure rank is a finite integer – guards against NaN / undefined / null leaking to the DB. */
const safeRank = (r: unknown): number => (typeof r === 'number' && Number.isFinite(r) ? r : 0);

type WorkItemUpsertRow = {
  id: string;
  title: string;
  description: string | null;
  points: number | null;
  status: string;
  parent_id: string | null;
  backlog_assignments: Record<string, string>;
  rank: number;
  organization_id: string;
  respawn_enabled: boolean;
  respawn_interval_days: number | null;
  respawn_hour: number | null;
  respawn_last_triggered_at: string | null;
};

// ─── Load all data from Supabase (filtered by org) ────────────────────────

export async function loadFromSupabase(organizationId: string): Promise<{
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
}> {
  // Load shared tree IDs for this org
  const { data: shares } = await supabase
    .from('backlog_tree_shares' as any)
    .select('tree_id')
    .eq('organization_id', organizationId);
  const sharedTreeIds = (shares ?? []).map((s: any) => s.tree_id as string);

  // Load own trees + shared trees
  const ownTreesPromise = supabase.from('backlog_trees').select('*').eq('organization_id', organizationId);
  const sharedTreesPromise = sharedTreeIds.length > 0
    ? supabase.from('backlog_trees').select('*').in('id', sharedTreeIds)
    : Promise.resolve({ data: [], error: null });

  const [ownTreesRes, sharedTreesRes] = await Promise.all([ownTreesPromise, sharedTreesPromise]);
  if (ownTreesRes.error) throw ownTreesRes.error;
  if (sharedTreesRes.error) throw sharedTreesRes.error;

  const allTreeRows = [...(ownTreesRes.data ?? []), ...(sharedTreesRes.data ?? [])];
  const allTreeIds = allTreeRows.map(t => t.id);

  // Load backlogs for all accessible trees
  const backlogsPromise = allTreeIds.length > 0
    ? supabase.from('backlogs').select('*').in('tree_id', allTreeIds)
    : Promise.resolve({ data: [], error: null });

  // Load own work items + work items from shared trees
  const ownItemsPromise = supabase.from('work_items').select('*').eq('organization_id', organizationId);

  const [backlogsRes, itemsRes] = await Promise.all([backlogsPromise, ownItemsPromise]);

  if (backlogsRes.error) throw backlogsRes.error;
  if (itemsRes.error) throw itemsRes.error;

  // Also load work items from partner orgs that participate in tree sharing.
  // This covers two directions:
  //   (A) Incoming shares: other orgs own trees shared TO this org – their items
  //       live under their own organization_id but are assigned to those trees.
  //   (B) Outgoing shares: this org owns trees shared WITH other orgs – items
  //       those orgs created in our trees live under their organization_id.
  let sharedWorkItems: any[] = [];

  // (A) Incoming: orgs that own the trees shared to us.
  if (sharedTreeIds.length > 0) {
    const sharedTreeIdSet = new Set(sharedTreeIds);
    const incomingPartnerOrgIds = [
      ...new Set(
        (sharedTreesRes.data ?? [])
          .map((t: any) => t.organization_id as string)
          .filter((id: string) => id !== organizationId)
      ),
    ];
    if (incomingPartnerOrgIds.length > 0) {
      const { data: incomingItems } = await supabase
        .from('work_items')
        .select('*')
        .in('organization_id', incomingPartnerOrgIds);
      // Keep only items that are actually assigned to one of the shared trees.
      const filtered = (incomingItems ?? []).filter((item: any) => {
        const assignments = item.backlog_assignments as Record<string, string>;
        return Object.keys(assignments).some(treeId => sharedTreeIdSet.has(treeId));
      });
      sharedWorkItems = [...sharedWorkItems, ...filtered];
    }
  }

  // (B) Outgoing: orgs that have been granted access to our own trees.
  const ownTreeIds = (ownTreesRes.data ?? []).map((t: any) => t.id as string);
  if (ownTreeIds.length > 0) {
    const { data: outgoingShares } = await supabase
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      .from('backlog_tree_shares' as any)
      .select('organization_id')
      .in('tree_id', ownTreeIds);
    const outgoingPartnerOrgIds = [
      ...new Set(
        (outgoingShares ?? [])
          .map((s: any) => s.organization_id as string)
          .filter((id: string) => id !== organizationId)
      ),
    ];
    if (outgoingPartnerOrgIds.length > 0) {
      const ownTreeIdSet = new Set(ownTreeIds);
      const { data: outgoingItems } = await supabase
        .from('work_items')
        .select('*')
        .in('organization_id', outgoingPartnerOrgIds);
      // Keep only items assigned to one of our own trees.
      const filtered = (outgoingItems ?? []).filter((item: any) => {
        const assignments = item.backlog_assignments as Record<string, string>;
        return Object.keys(assignments).some(treeId => ownTreeIdSet.has(treeId));
      });
      sharedWorkItems = [...sharedWorkItems, ...filtered];
    }
  }

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
    backlogTrees[row.id] = { id: row.id, name: row.name, rootBacklogIds: [], rank: row.rank };
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
    backlogs[row.id] = { id: row.id, name: row.name, parentId: row.parent_id, childrenIds: [], treeId: row.tree_id, rank: row.rank };
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

  const allItemRows = [...(itemsRes.data ?? []), ...sharedWorkItems];

  // Auto-cleanup malformed (double-prefixed) work item IDs
  const malformedItemIds = allItemRows.filter(r => r.id.split('::').length > 2).map(r => r.id);
  if (malformedItemIds.length > 0) {
    supabase.from('work_items').delete().in('id', malformedItemIds).then(({ error }) => {
      if (error) console.error('cleanup malformed work items:', error);
    });
  }
  const cleanItemRows = allItemRows.filter(r => r.id.split('::').length <= 2);

  const workItems: Record<string, WorkItem> = {};
  for (const row of cleanItemRows) {
    const r = row as any;
    workItems[row.id] = {
      id: row.id, title: row.title, description: row.description ?? undefined,
      points: row.points ?? undefined, status: (row.status as WorkItemStatus) ?? 'not_started',
      parentId: row.parent_id, childrenIds: [],
      backlogAssignments: (row.backlog_assignments as Record<string, string>) ?? {},
      rank: row.rank,
      respawnEnabled: r.respawn_enabled ?? false,
      respawnIntervalDays: r.respawn_interval_days ?? undefined,
      respawnHour: r.respawn_hour ?? undefined,
      respawnLastTriggeredAt: r.respawn_last_triggered_at ?? undefined,
    };
  }
  for (const wi of Object.values(workItems)) {
    if (wi.parentId && workItems[wi.parentId]) {
      workItems[wi.parentId].childrenIds.push(wi.id);
    }
  }
  for (const wi of Object.values(workItems)) {
    wi.childrenIds.sort((a, b) => (workItems[a]?.rank ?? 0) - (workItems[b]?.rank ?? 0));
  }

  return { workItems, backlogs, backlogTrees };
}

// ─── Helpers ───────────────────────────────────────────────────────────────

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

// ─── Sync helpers ──────────────────────────────────────────────────────────

/** Refresh the Supabase auth session and retry a DB operation once on auth errors. */
async function withSessionRetry(
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

  const { error: refreshError } = await supabase.auth.refreshSession();
  if (refreshError) return result; // Refresh itself failed – surface the original error.

  return operation();
}

export async function upsertWorkItem(item: WorkItem, organizationId: string) {
  const row: WorkItemUpsertRow = {
    id: item.id, title: item.title, description: item.description ?? null,
    points: item.points ?? null, status: item.status, parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments, rank: safeRank(item.rank),
    organization_id: ownerOrgOf(item.id, organizationId),
    respawn_enabled: item.respawnEnabled ?? false,
    respawn_interval_days: item.respawnIntervalDays ?? null,
    respawn_hour: item.respawnHour ?? null,
    respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
  };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(row as any).select().then(r => r));
  if (error) {
    console.error('upsertWorkItem:', error);
    toast({ title: 'Failed to save', description: 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
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
  const { error } = await supabase.from('work_items').delete().in('id', [...allIds]);
  if (error) console.error('deleteWorkItems:', error);
}

export async function upsertBacklog(bl: Backlog, organizationId: string) {
  const { error } = await supabase.from('backlogs').upsert({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: safeRank(bl.rank),
    organization_id: ownerOrgOf(bl.id, organizationId),
  });
  if (error) console.error('upsertBacklog:', error);
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
  });
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

export async function upsertWorkItems(items: WorkItem[], organizationId: string) {
  if (items.length === 0) return;
  const rows: WorkItemUpsertRow[] = items.map(item => ({
    id: item.id, title: item.title, description: item.description ?? null,
    points: item.points ?? null, status: item.status, parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments, rank: safeRank(item.rank),
    organization_id: ownerOrgOf(item.id, organizationId),
    respawn_enabled: item.respawnEnabled ?? false,
    respawn_interval_days: item.respawnIntervalDays ?? null,
    respawn_hour: item.respawnHour ?? null,
    respawn_last_triggered_at: item.respawnLastTriggeredAt ?? null,
  }));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { error } = await withSessionRetry(() => supabase.from('work_items').upsert(rows as any).select().then(r => r));
  if (error) {
    console.error('upsertWorkItems:', error);
    toast({ title: 'Failed to save', description: 'Your changes could not be saved. Please check your connection and try again.', variant: 'destructive' });
  }
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
  }));
  const { error } = await supabase.from('backlog_trees').upsert(rows);
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
        },
      ];
    })
  );

  return { workItems, backlogs, backlogTrees };
}

export async function resetOrgData(organizationId: string, mockData: MockDataSnapshot) {
  const scopedMockData = scopeMockDataToOrganization(organizationId, mockData);

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
    backlog_assignments: item.backlogAssignments,
    rank: safeRank(item.rank),
    organization_id: organizationId,
  }));
  if (itemRows.length > 0) {
    const { error } = await supabase.from('work_items').insert(itemRows);
    if (error) throw error;
  }
}

// ─── Hyperlink CRUD ───────────────────────────────────────────────────────

export async function loadHyperlinksForWorkItems(workItemIds: string[]): Promise<Record<string, Hyperlink[]>> {
  if (workItemIds.length === 0) return {};
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data, error } = await supabase.from('work_item_hyperlinks' as any).select('*').in('work_item_id', workItemIds).order('rank');
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

export async function upsertHyperlink(link: Hyperlink, organizationId: string) {
  const row = {
    id: link.id,
    work_item_id: link.workItemId,
    url: link.url,
    alt_text: link.altText,
    rank: safeRank(link.rank),
    organization_id: ownerOrgOf(link.workItemId, organizationId),
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
