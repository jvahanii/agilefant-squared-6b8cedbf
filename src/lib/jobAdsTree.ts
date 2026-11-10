import type { WorkItem } from "@/types/models";
import { itemFieldsChanged } from "./itemFieldsChanged";

/**
 * The job hunt's own backlog tree — "Työpaikkalistaukset" — held by id rather
 * than by name, so renaming the tree does not quietly stop the count that
 * follows, the way renaming a list once stopped auto-place.
 */
export const JOB_ADS_TREE_ID = "227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-47861693";

/**
 * How many work items that tree holds, at every level and across all its
 * lists: what the header's job search button reports, so the size of the hunt
 * is visible without opening it. Zero for anyone whose data has no such tree.
 */
export function countItemsInTree(
  workItems: Record<string, Pick<WorkItem, "backlogAssignments">>,
  treeId: string,
): number {
  return Object.values(workItems ?? {}).filter((item) => !!item.backlogAssignments?.[treeId]).length;
}

/**
 * The count of the job hunt's tree in these items, counted again only when an
 * item has come or gone or moved between trees. The header's button reads it on
 * every change to the items; counted over every item each time, it took a few
 * milliseconds of every edit, in every organization.
 */
let counted: { items: Record<string, WorkItem>; count: number } | null = null;
export function jobAdCount(items: Record<string, WorkItem>): number {
  if (!counted || itemFieldsChanged(counted.items, items, ["backlogAssignments"])) {
    counted = { items, count: countItemsInTree(items, JOB_ADS_TREE_ID) };
  } else counted.items = items;
  return counted.count;
}
