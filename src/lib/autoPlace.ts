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
 * The two lists are named, not configured: they are the ones this job hunt uses.
 * The button appears only where both names exist in the tree being imported
 * into, so any other tree simply does not offer it.
 */
export const AUTO_PLACE_BACKLOGS = {
  withDeadline: "Deadlinella",
  withoutDeadline: "Toistaiseksi avoimet",
} as const;

export interface AutoPlaceTargets {
  withDeadline: string;
  withoutDeadline: string;
}

const sameName = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** The two target backlogs in this tree, or null when either is missing. */
export function findAutoPlaceTargets(
  backlogs: Record<string, Backlog>,
  treeId: string | null | undefined,
): AutoPlaceTargets | null {
  if (!treeId || !backlogs) return null;
  const inTree = Object.values(backlogs).filter((b) => b.treeId === treeId);
  const withDeadline = inTree.find((b) => sameName(b.name, AUTO_PLACE_BACKLOGS.withDeadline));
  const withoutDeadline = inTree.find((b) => sameName(b.name, AUTO_PLACE_BACKLOGS.withoutDeadline));
  return withDeadline && withoutDeadline
    ? { withDeadline: withDeadline.id, withoutDeadline: withoutDeadline.id }
    : null;
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
