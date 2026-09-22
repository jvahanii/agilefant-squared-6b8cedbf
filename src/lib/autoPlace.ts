import type { Backlog, WorkItem } from "@/types/models";
import { deadlinePassed, titleDeadline } from "../../supabase/functions/_shared/deadlines";

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
 * "MWB uuden työn saaminen" tree. The list a saved search mirrors into until it
 * chooses another, which is where the picker mirrored before the list could be
 * chosen.
 *
 * Kept by id for the same reason as the lists above: found by name, a rename
 * would make the step quietly stop.
 */
export const DEFAULT_MIRROR_BACKLOG_ID = "227ff1d1-36df-4f46-b97e-483ada92ccfb::bl-34431983";

/**
 * Where the postings switched on in the picker are mirrored: the list the
 * search chose, or the default when it has chosen none. Null when there is
 * nowhere to — the list is not in this organisation's data, or sits in the
 * tree being imported into. An item holds one list per tree, so it cannot be
 * mirrored within the same tree: filing it there would move it out of its own
 * list.
 */
export function findMirrorTarget(
  backlogs: Record<string, Backlog>,
  importTreeId: string,
  chosenBacklogId?: string | null,
): { backlogId: string; treeId: string } | null {
  const target = backlogs?.[chosenBacklogId || DEFAULT_MIRROR_BACKLOG_ID];
  if (!target || target.treeId === importTreeId) return null;
  return { backlogId: target.id, treeId: target.treeId };
}

/** How long the auto-place summary stays on screen. */
export const AUTO_PLACE_TOAST_MS = 10_000;

/**
 * How many of these job ads are still open. An ad counts as closed when the
 * closing date its title starts with has gone by, or when a posting check has
 * marked it closed — the same two sources the list's own closed marks use.
 * The title date is the one that always holds: it needs no request, so it
 * covers the boards that will not answer one.
 */
export function countOpenAds(
  items: Pick<WorkItem, "id" | "title">[],
  closedIds: ReadonlySet<string>,
  now: Date | string | number = Date.now(),
): number {
  return items.filter((item) => !closedIds.has(item.id) && !deadlinePassed(titleDeadline(item.title, now), now)).length;
}
