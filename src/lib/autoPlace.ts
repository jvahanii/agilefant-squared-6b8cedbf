import type { Backlog } from "@/types/models";

/**
 * Filing imported job ads by whether they have a closing date.
 *
 * A job hunt splits the same way every time: the ones with a deadline are the
 * ones to plan around, and the open-ended ones can wait. Rather than import
 * everything into one list and sort it out by hand afterwards, "Import &
 * auto-place" sends each posting to the list it belongs in and puts both lists
 * in name order — which, because an imported title starts with its closing date,
 * is closing-date order.
 *
 * The two lists are chosen per saved search and kept by id. They used to be
 * found by name, and renaming either one made the button quietly disappear.
 */

export interface AutoPlaceTargets {
  withDeadline: string;
  withoutDeadline: string;
}

/** The part of a saved search that says where auto-place files things. */
export interface AutoPlaceSettings {
  tree_id: string;
  auto_place_dated_backlog_id?: string | null;
  auto_place_undated_backlog_id?: string | null;
}

/**
 * The two target backlogs, or null when auto-place is not set up for this
 * search — either one unset, deleted, or moved out of the search's tree.
 */
export function findAutoPlaceTargets(
  backlogs: Record<string, Backlog>,
  search: AutoPlaceSettings | null | undefined,
): AutoPlaceTargets | null {
  if (!search?.tree_id || !backlogs) return null;
  const inTree = (id: string | null | undefined) =>
    id && backlogs[id]?.treeId === search.tree_id ? id : null;
  const withDeadline = inTree(search.auto_place_dated_backlog_id);
  const withoutDeadline = inTree(search.auto_place_undated_backlog_id);
  return withDeadline && withoutDeadline ? { withDeadline, withoutDeadline } : null;
}

/**
 * Which list each posting goes to. A posting counts as having a deadline only
 * when it states a date: "open until further notice" is an answer, but it is not
 * a date, and it belongs with the open-ended ones.
 */
export function splitByDeadline<T extends { deadline?: string }>(links: T[]): { dated: T[]; undated: T[] } {
  const dated: T[] = [];
  const undated: T[] = [];
  for (const link of links) (link.deadline ? dated : undated).push(link);
  return { dated, undated };
}

/**
 * "Hae näitä seuraavaksi" — the shortlist of jobs to apply for next, in the
 * "MWB uuden työn saaminen" tree. Postings marked In progress in the picker are
 * the ones already chosen to pursue, so auto-place also shows them there.
 *
 * Kept by id for the same reason as the lists above: found by name, a rename
 * would make the step quietly stop.
 */
export const APPLY_NEXT_BACKLOG_ID = "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-34431983";

/** The status a posting is given in the picker to send it to the shortlist. */
export const APPLY_NEXT_STATUS = "in_progress";

/**
 * Where In-progress postings are mirrored, or null when there is nowhere to:
 * the list is not in this organisation's data, or sits in the tree being
 * imported into. An item holds one list per tree, so it cannot be mirrored
 * within the same tree — filing it there would move it out of its own list.
 */
export function findApplyNextTarget(
  backlogs: Record<string, Backlog>,
  importTreeId: string,
): { backlogId: string; treeId: string } | null {
  const target = backlogs?.[APPLY_NEXT_BACKLOG_ID];
  if (!target || target.treeId === importTreeId) return null;
  return { backlogId: target.id, treeId: target.treeId };
}
