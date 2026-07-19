import { useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useDeleteGuardStore } from '@/store/deleteGuardStore';
import { collectAffectedTimeEntryIds, type DeleteTarget } from '@/lib/timeUtils';

/**
 * Returns a function that, given a delete target and the actual delete
 * callback, prompts the user to move logged time first when applicable.
 * When no time entries would be orphaned, runs the delete immediately.
 */
export function useDeleteWithTimeGuard() {
  const request = useDeleteGuardStore((s) => s.request);

  return useCallback(
    (target: DeleteTarget, label: string, onConfirm: () => void) => {
      const { workItems, backlogs } = useAppStore.getState();
      const { timeEntries } = useTimeEntryStore.getState();
      const entryIds = collectAffectedTimeEntryIds(target, {
        workItems,
        backlogs,
        timeEntries,
      });
      if (entryIds.length === 0) {
        onConfirm();
        return;
      }
      request({ target, entryIds, label, onConfirm });
    },
    [request],
  );
}
