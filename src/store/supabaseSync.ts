import { supabase } from '@/integrations/supabase/client';
import { WorkItem, WorkItemStatus, Backlog, BacklogTree } from '@/types/models';

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

  // Also load work items from shared trees that belong to other orgs
  let sharedWorkItems: any[] = [];
  if (sharedTreeIds.length > 0) {
    // Load all work items that reference shared trees (from other orgs)
    const { data: allSharedItems } = await supabase
      .from('work_items')
      .select('*')
      .neq('organization_id', organizationId);
    // Filter to items that have assignments to shared trees
    sharedWorkItems = (allSharedItems ?? []).filter((item: any) => {
      const assignments = item.backlog_assignments as Record<string, string>;
      return Object.keys(assignments).some(treeId => sharedTreeIds.includes(treeId));
    });
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
    workItems[row.id] = {
      id: row.id, title: row.title, description: row.description ?? undefined,
      points: row.points ?? undefined, status: (row.status as WorkItemStatus) ?? 'not_started',
      parentId: row.parent_id, childrenIds: [],
      backlogAssignments: (row.backlog_assignments as Record<string, string>) ?? {},
      rank: row.rank,
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

// ─── Sync helpers ──────────────────────────────────────────────────────────

export async function upsertWorkItem(item: WorkItem, organizationId: string) {
  const { error } = await supabase.from('work_items').upsert({
    id: item.id, title: item.title, description: item.description ?? null,
    points: item.points ?? null, status: item.status, parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments, rank: item.rank,
    organization_id: organizationId,
  });
  if (error) console.error('upsertWorkItem:', error);
}

export async function deleteWorkItems(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from('work_items').delete().in('id', ids);
  if (error) console.error('deleteWorkItems:', error);
}

export async function upsertBacklog(bl: Backlog, organizationId: string) {
  const { error } = await supabase.from('backlogs').upsert({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: bl.rank,
    organization_id: organizationId,
  });
  if (error) console.error('upsertBacklog:', error);
}

export async function deleteBacklogs(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from('backlogs').delete().in('id', ids);
  if (error) console.error('deleteBacklogs:', error);
}

export async function upsertBacklogTree(tree: BacklogTree, organizationId: string) {
  const { error } = await supabase.from('backlog_trees').upsert({
    id: tree.id, name: tree.name, rank: tree.rank,
    organization_id: organizationId,
  });
  if (error) console.error('upsertBacklogTree:', error);
}

export async function deleteBacklogTree(id: string) {
  const { error } = await supabase.from('backlog_trees').delete().eq('id', id);
  if (error) console.error('deleteBacklogTree:', error);
}

export async function upsertWorkItems(items: WorkItem[], organizationId: string) {
  if (items.length === 0) return;
  const rows = items.map(item => ({
    id: item.id, title: item.title, description: item.description ?? null,
    points: item.points ?? null, status: item.status, parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments, rank: item.rank,
    organization_id: organizationId,
  }));
  const { error } = await supabase.from('work_items').upsert(rows);
  if (error) console.error('upsertWorkItems:', error);
}

export async function upsertBacklogs(bls: Backlog[], organizationId: string) {
  if (bls.length === 0) return;
  const rows = bls.map(bl => ({
    id: bl.id, name: bl.name, parent_id: bl.parentId, tree_id: bl.treeId, rank: bl.rank,
    organization_id: organizationId,
  }));
  const { error } = await supabase.from('backlogs').upsert(rows);
  if (error) console.error('upsertBacklogs:', error);
}

export async function upsertBacklogTrees(trees: BacklogTree[], organizationId: string) {
  if (trees.length === 0) return;
  const rows = trees.map(t => ({
    id: t.id, name: t.name, rank: t.rank,
    organization_id: organizationId,
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
    rank: tree.rank,
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
    rank: backlog.rank,
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
    rank: item.rank,
    organization_id: organizationId,
  }));
  if (itemRows.length > 0) {
    const { error } = await supabase.from('work_items').insert(itemRows);
    if (error) throw error;
  }
}
