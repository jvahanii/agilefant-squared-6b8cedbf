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
