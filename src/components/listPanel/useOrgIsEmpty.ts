import { useAppStore } from "@/store/appStore";
import type { WorkItem } from "@/types/models";

/** An item last seen in the map: while it is still there, the map is not empty. */
let knownItemId: string | null = null;

/**
 * Whether the map holds no items. Asked at every change to the store, by every
 * component that uses it, of a map of thousands: counting its keys took some
 * 5 ms of each key press, and so does even a for-in that stops at the first
 * key, since V8 lists all the keys of a map this size before handing out one.
 * Looking up one item known to be there costs nothing; the keys are listed
 * only when that item is gone.
 */
export function noItems(workItems: Record<string, WorkItem>): boolean {
  if (knownItemId !== null && knownItemId in workItems) return false;
  knownItemId = null;
  for (const id in workItems) {
    knownItemId = id;
    return false;
  }
  return true;
}

/**
 * True once everything has loaded and the organisation has no items at all:
 * a new account, or one emptied since. Not while cached data is on screen and
 * the real data is still coming, since an empty list may just not have
 * arrived yet.
 */
export function useOrgIsEmpty(): boolean {
  return useAppStore((s) => !s.isLoading && !s.workItemsLoading && !s.workItemsRefreshing && noItems(s.workItems));
}
