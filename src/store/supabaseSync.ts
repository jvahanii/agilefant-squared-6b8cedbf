import { supabase } from '@/integrations/supabase/client';
import { WorkItem, WorkItemStatus, Backlog, BacklogTree } from '@/types/models';

// ─── Load all data from Supabase ───────────────────────────────────────────

export async function loadFromSupabase(): Promise<{
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
}> {
  const [treesRes, backlogsRes, itemsRes] = await Promise.all([
    supabase.from('backlog_trees').select('*'),
    supabase.from('backlogs').select('*'),
    supabase.from('work_items').select('*'),
  ]);

  if (treesRes.error) throw treesRes.error;
  if (backlogsRes.error) throw backlogsRes.error;
  if (itemsRes.error) throw itemsRes.error;

  // Build backlog trees
  const backlogTrees: Record<string, BacklogTree> = {};
  for (const row of treesRes.data) {
    backlogTrees[row.id] = {
      id: row.id,
      name: row.name,
      rootBacklogIds: [],
      rank: row.rank,
    };
  }

  // Build backlogs and compute childrenIds + rootBacklogIds
  const backlogs: Record<string, Backlog> = {};
  for (const row of backlogsRes.data) {
    backlogs[row.id] = {
      id: row.id,
      name: row.name,
      parentId: row.parent_id,
      childrenIds: [],
      treeId: row.tree_id,
      rank: row.rank,
    };
  }
  // Wire up children and root lists
  for (const bl of Object.values(backlogs)) {
    if (bl.parentId && backlogs[bl.parentId]) {
      backlogs[bl.parentId].childrenIds.push(bl.id);
    } else if (!bl.parentId && backlogTrees[bl.treeId]) {
      backlogTrees[bl.treeId].rootBacklogIds.push(bl.id);
    }
  }
  // Sort children by rank
  for (const bl of Object.values(backlogs)) {
    bl.childrenIds.sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0));
  }
  for (const tree of Object.values(backlogTrees)) {
    tree.rootBacklogIds.sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0));
  }

  // Build work items and compute childrenIds
  const workItems: Record<string, WorkItem> = {};
  for (const row of itemsRes.data) {
    workItems[row.id] = {
      id: row.id,
      title: row.title,
      description: row.description ?? undefined,
      points: row.points ?? undefined,
      parentId: row.parent_id,
      childrenIds: [],
      backlogAssignments: (row.backlog_assignments as Record<string, string>) ?? {},
      rank: row.rank,
    };
  }
  for (const wi of Object.values(workItems)) {
    if (wi.parentId && workItems[wi.parentId]) {
      workItems[wi.parentId].childrenIds.push(wi.id);
    }
  }
  // Sort children by rank
  for (const wi of Object.values(workItems)) {
    wi.childrenIds.sort((a, b) => (workItems[a]?.rank ?? 0) - (workItems[b]?.rank ?? 0));
  }

  return { workItems, backlogs, backlogTrees };
}

// ─── Sync helpers (fire-and-forget writes to Supabase) ─────────────────────

export async function upsertWorkItem(item: WorkItem) {
  const { error } = await supabase.from('work_items').upsert({
    id: item.id,
    title: item.title,
    description: item.description ?? null,
    points: item.points ?? null,
    parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments,
    rank: item.rank,
  });
  if (error) console.error('upsertWorkItem:', error);
}

export async function deleteWorkItems(ids: string[]) {
  if (ids.length === 0) return;
  const { error } = await supabase.from('work_items').delete().in('id', ids);
  if (error) console.error('deleteWorkItems:', error);
}

export async function upsertBacklog(bl: Backlog) {
  const { error } = await supabase.from('backlogs').upsert({
    id: bl.id,
    name: bl.name,
    parent_id: bl.parentId,
    tree_id: bl.treeId,
    rank: bl.rank,
  });
  if (error) console.error('upsertBacklog:', error);
}

export async function deleteBacklogs(ids: string[]) {
  if (ids.length === 0) return;
  // Delete children first (cascade should handle it but let's be safe)
  const { error } = await supabase.from('backlogs').delete().in('id', ids);
  if (error) console.error('deleteBacklogs:', error);
}

export async function upsertBacklogTree(tree: BacklogTree) {
  const { error } = await supabase.from('backlog_trees').upsert({
    id: tree.id,
    name: tree.name,
    rank: tree.rank,
  });
  if (error) console.error('upsertBacklogTree:', error);
}

export async function deleteBacklogTree(id: string) {
  const { error } = await supabase.from('backlog_trees').delete().eq('id', id);
  if (error) console.error('deleteBacklogTree:', error);
}

/** Bulk upsert multiple work items */
export async function upsertWorkItems(items: WorkItem[]) {
  if (items.length === 0) return;
  const rows = items.map(item => ({
    id: item.id,
    title: item.title,
    description: item.description ?? null,
    points: item.points ?? null,
    parent_id: item.parentId,
    backlog_assignments: item.backlogAssignments,
    rank: item.rank,
  }));
  const { error } = await supabase.from('work_items').upsert(rows);
  if (error) console.error('upsertWorkItems:', error);
}

/** Bulk upsert multiple backlogs */
export async function upsertBacklogs(bls: Backlog[]) {
  if (bls.length === 0) return;
  const rows = bls.map(bl => ({
    id: bl.id,
    name: bl.name,
    parent_id: bl.parentId,
    tree_id: bl.treeId,
    rank: bl.rank,
  }));
  const { error } = await supabase.from('backlogs').upsert(rows);
  if (error) console.error('upsertBacklogs:', error);
}

/** Bulk upsert multiple backlog trees */
export async function upsertBacklogTrees(trees: BacklogTree[]) {
  if (trees.length === 0) return;
  const rows = trees.map(t => ({
    id: t.id,
    name: t.name,
    rank: t.rank,
  }));
  const { error } = await supabase.from('backlog_trees').upsert(rows);
  if (error) console.error('upsertBacklogTrees:', error);
}
