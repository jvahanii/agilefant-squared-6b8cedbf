import { useAppStore } from "@/store/appStore";

/**
 * True once everything has loaded and the organisation has no items at all:
 * a new account, or one emptied since. Not while cached data is on screen and
 * the real data is still coming, since an empty list may just not have
 * arrived yet.
 */
export function useOrgIsEmpty(): boolean {
  return useAppStore(
    (s) => !s.isLoading && !s.workItemsLoading && !s.workItemsRefreshing && Object.keys(s.workItems).length === 0,
  );
}
