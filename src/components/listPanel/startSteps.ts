import { toIsoDate } from "@/lib/deadlineFormat";
import type { WorkItem } from "@/types/models";

/** How long after its first item an organisation still counts as new. */
export const NEW_ORG_DAYS = 14;

export type StepKey = "more" | "nest" | "done";
export interface Step {
  key: StepKey;
  done: boolean;
}

/**
 * The getting-started steps and whether each is done, read from the items
 * themselves so they tick off wherever the person does them. Null for an
 * organisation with no items (the first-item prompt is showing) or one that
 * is not new: an item older than NEW_ORG_DAYS, or of unknown age, means it
 * has been in use for a while.
 */
export function gettingStartedSteps(items: WorkItem[], today: Date = new Date()): Step[] | null {
  if (items.length === 0) return null;
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - NEW_ORG_DAYS);
  const oldest = toIsoDate(cutoff);
  if (items.some((i) => !i.createdOn || i.createdOn < oldest)) return null;
  return [
    { key: "more", done: items.length >= 3 },
    { key: "nest", done: items.some((i) => !!i.parentId) },
    { key: "done", done: items.some((i) => i.status === "done") },
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
