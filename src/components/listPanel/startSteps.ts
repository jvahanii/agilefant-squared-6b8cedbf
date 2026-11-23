import { toIsoDate } from "@/lib/deadlineFormat";
import type { WorkItem } from "@/types/models";

/** How long after its first item an organisation still counts as new. */
export const NEW_ORG_DAYS = 14;

export type StepKey = "more" | "nest" | "done";
export interface Step {
  key: StepKey;
  done: boolean;
}

/** An item found old enough to say the organisation is not new. */
let settledBy: string | null = null;

/**
 * The getting-started steps and whether each is done, read from the items
 * themselves so they tick off wherever the person does them. Null for an
 * organisation with no items (the first-item prompt is showing) or one that
 * is not new: an item older than NEW_ORG_DAYS, or of unknown age, means it
 * has been in use for a while.
 *
 * Asked at every change to any item. For an organisation in use one old item
 * settles it, so the one found last time is looked up first: going through
 * thousands of items took a few milliseconds of every key press.
 */
export function gettingStartedSteps(
  items: WorkItem[] | Record<string, WorkItem>,
  today: Date = new Date(),
): Step[] | null {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - NEW_ORG_DAYS);
  const oldest = toIsoDate(cutoff);
  const isOld = (i: WorkItem) => !i.createdOn || i.createdOn < oldest;
  if (!Array.isArray(items) && settledBy !== null) {
    const known = items[settledBy];
    if (known && isOld(known)) return null;
  }
  const all = Array.isArray(items) ? items : Object.values(items);
  let count = 0;
  let nested = false;
  let done = false;
  for (const i of all) {
    if (isOld(i)) {
      settledBy = i.id;
      return null;
    }
    count++;
    nested ||= !!i.parentId;
    done ||= i.status === "done";
  }
  if (count === 0) return null;
  return [
    { key: "more", done: count >= 3 },
    { key: "nest", done: nested },
    { key: "done", done },
  ];
}

const closedKey = (orgId: string) => `agilefant.gettingStarted.closed.${orgId}`;

/** Whether this browser closed the steps for this organisation. */
export function stepsClosed(orgId: string): boolean {
  try {
    return localStorage.getItem(closedKey(orgId)) === "1";
  } catch {
    return false;
  }
}

export function closeSteps(orgId: string): void {
  try {
    localStorage.setItem(closedKey(orgId), "1");
  } catch {
    // Private windows can refuse storage; the steps then close for this visit only.
  }
}
