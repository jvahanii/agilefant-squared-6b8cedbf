import { useAppStore } from "@/store/appStore";
import { useJiraIssuesStore, type JiraIssueRef, type JiraListRef } from "@/store/jiraIssuesStore";
import type { WorkItem } from "@/types/models";
import { expectedLayout, Levels } from "../../supabase/functions/_shared/jiraMapping";

/**
 * The Jira type each synced item will have once the sync has caught up with
 * Agilefant's hierarchy as it is now — the type a move gives an item, shown
 * the moment it is made rather than seconds later, when Jira has made it.
 *
 * The sync's own levelling (expectedTypes, beside planMove), run on the
 * space's items as the sync has them: the list's, those synced with it that
 * were moved elsewhere, and any under one of these, each under its parent in
 * the list's tree, the same parent the sync reads. Items not in Jira yet are
 * given the type the sync will create them as. Nothing for a list whose
 * project's levels the sync has not yet recorded.
 */
export interface ExpectedJiraType {
  type: string;
  /** The Jira project, for an item the sync has yet to create there. */
  projectKey: string;
  /** Deeper in Agilefant than Jira's levels: in Jira one level flatter. */
  flattened: boolean;
  /** How many levels the project's hierarchy has. */
  levels: number;
}

export function expectedJiraTypes(
  workItems: Record<string, WorkItem>,
  byItem: ReadonlyMap<string, JiraIssueRef>,
  byList: ReadonlyMap<string, JiraListRef>,
): Map<string, ExpectedJiraType> {
  if (cache && cache.workItems === workItems && cache.byItem === byItem && cache.byList === byList) return cache.result;
  const result = new Map<string, ExpectedJiraType>();
  for (const [backlogId, list] of byList) {
    if (!list.issueTypes) continue;
    const nodes = new Map<string, { type: string | null; parent: string | null }>();
    const parentOf = (item: WorkItem) => item.parentIds?.[list.treeId] ?? item.parentId;
    const add = (item: WorkItem) => nodes.set(item.id, { type: byItem.get(item.id)?.type ?? null, parent: parentOf(item) });
    // The tree's other items, by parent: those under one of the space's are the space's too.
    const others = new Map<string, WorkItem[]>();
    for (const item of Object.values(workItems)) {
      const assigned = item.backlogAssignments?.[list.treeId];
      if (!assigned) continue;
      if (assigned === backlogId || byItem.get(item.id)?.listId === backlogId) add(item);
      else {
        const parent = parentOf(item);
        if (parent) others.set(parent, [...(others.get(parent) ?? []), item]);
      }
    }
    const below = [...nodes.keys()];
    while (below.length > 0) {
      for (const child of others.get(below.pop()!) ?? []) {
        if (nodes.has(child.id)) continue;
        add(child);
        below.push(child.id);
      }
    }
    const levels = new Levels(list.issueTypes);
    for (const [id, { type, flattened }] of expectedLayout(nodes, levels)) {
      result.set(id, { type, projectKey: list.projectKey, flattened, levels: levels.count });
    }
  }
  cache = { workItems, byItem, byList, result };
  return result;
}

// Worked out once per change and shared by every row's tag.
let cache: {
  workItems: Record<string, WorkItem>;
  byItem: ReadonlyMap<string, JiraIssueRef>;
  byList: ReadonlyMap<string, JiraListRef>;
  result: Map<string, ExpectedJiraType>;
} | null = null;

/** The type this item will have in Jira, or undefined where none can be said. */
export function useExpectedJiraType(workItemId: string): ExpectedJiraType | undefined {
  const byItem = useJiraIssuesStore((s) => s.byItem);
  const byList = useJiraIssuesStore((s) => s.byList);
  return useAppStore((s) => expectedJiraTypes(s.workItems, byItem, byList).get(workItemId));
}
