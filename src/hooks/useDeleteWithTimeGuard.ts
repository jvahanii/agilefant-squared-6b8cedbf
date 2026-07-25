import { useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useDeleteGuardStore } from '@/store/deleteGuardStore';
import { collectAffectedTimeEntryIdsBulk, type DeleteTarget } from '@/lib/timeUtils';

export function useDeleteWithTimeGuard() {
  const request = useDeleteGuardStore((s) => s.request);

  return useCallback(
    (
      target: DeleteTarget | DeleteTarget[],
      label: string,
      onConfirm: () => void,
    ) => {
      const { workItems, backlogs } = useAppStore.getState();
      const { timeEntries } = useTimeEntryStore.getState();
      const targets = Array.isArray(target) ? target : [target];
      const entryIds = collectAffectedTimeEntryIdsBulk(targets, { workItems, backlogs, timeEntries });
      if (entryIds.length === 0) {
        onConfirm();
        return;
      }
      request({
        target: targets[0],
        entryIds,
        label,
        onConfirm,
      });
    },
    [request],
  );
}
