import type { Backlog, WorkItem } from "@/types/models";
import { deadlinePassed, titleDeadline } from "../../supabase/functions/_shared/deadlines";

/**
 * Where the job picker imports to, and how the list is left afterwards.
 *
 * Every posting chosen goes into one list. It used to be two — one for the
 * postings with a closing date, one for the rest — from when the date lived in
 * an item's name and a list could only be ordered by it. A deadline is a field
 * of its own now, so one list holds both and is kept in the order that used to
 * take two: the jobs with a deadline first, soonest at the top, then the jobs
 * without one, by name.
 *
 * The list is chosen per saved search and kept by id. Found by name, a rename
 * would make the import quietly stop.
 */

/** The part of a saved search that says where its picker imports to. */
export interface ImportListSettings {
  tree_id: string;
  auto_place_backlog_id?: string | null;
}

/**
 * The list the picker imports into, or null when the search has not chosen
 * one — or the one it chose has been deleted, or moved out of the search's tree.
 */
export function findImportList(
  backlogs: Record<string, Backlog>,
  search: ImportListSettings | null | undefined,
): string | null {
  const id = search?.auto_place_backlog_id;
  if (!search?.tree_id || !backlogs || !id) return null;
  return backlogs[id]?.treeId === search.tree_id ? id : null;
}

/**
 * The order the list is left in: the jobs with a deadline first, soonest at
 * the top, then the jobs without one — each group by name where nothing else
 * decides. `byName` is the list already in name order.
 *
 * Where the organization keeps deadlines as a field, that is a sort by
 * deadline that leaves name order standing among equals. Where it does not,
 * the date is the start of the name — "0930 Fennia - Product owner" — and name
 * order already is that order: digits sort ahead of letters.
 */
export function importListOrder<T extends Pick<WorkItem, "deadline">>(byName: T[], deadlinesAsField: boolean): T[] {
  if (!deadlinesAsField) return byName;
  const dated = byName.filter((item) => item.deadline);
  const undated = byName.filter((item) => !item.deadline);
  // A stable sort: two jobs closing the same day stay in name order.
  return [...dated.sort((a, b) => (a.deadline! < b.deadline! ? -1 : a.deadline! > b.deadline! ? 1 : 0)), ...undated];
}

/**
 * "Hae näitä seuraavaksi" — the shortlist of jobs to apply for next, in the
 * "MWB uuden työn saaminen" tree. The list a saved search mirrors into until it
 * chooses another, which is where the picker mirrored before the list could be
 * chosen.
 *
 * Kept by id for the same reason as the list above: found by name, a rename
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

/** How long the import's summary stays on screen. */
export const AUTO_PLACE_TOAST_MS = 10_000;

/**
 * How many of these job ads are still open. An ad counts as closed when its
 * deadline — or, without deadlines, the date its title starts with — has gone by, or when a posting check has
 * marked it closed — the same two sources the list's own closed marks use.
 * The title date is the one that always holds: it needs no request, so it
 * covers the boards that will not answer one.
 */
/**
 * Whether a job ad has a closing date at all: its deadline, or — where the
 * organization keeps none — the date its name starts with.
 */
export function hasClosingDate(
  item: Pick<WorkItem, "title" | "deadline">,
  now: Date | string | number = Date.now(),
): boolean {
  return !!(item.deadline ?? titleDeadline(item.title, now));
}

export function countOpenAds(
  items: Pick<WorkItem, "id" | "title" | "deadline">[],
  closedIds: ReadonlySet<string>,
  now: Date | string | number = Date.now(),
): number {
  return items.filter((item) => !closedIds.has(item.id) && !deadlinePassed(item.deadline ?? titleDeadline(item.title, now), now)).length;
}
