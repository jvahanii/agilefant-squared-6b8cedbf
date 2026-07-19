import { useCallback } from 'react';
import { useAppStore } from '@/store/appStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useDeleteGuardStore } from '@/store/deleteGuardStore';
import { collectAffectedTimeEntryIds, type DeleteTarget } from '@/lib/timeUtils';

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
      const seen = new Set<string>();
      const entryIds: string[] = [];
      for (const t of targets) {
        for (const id of collectAffectedTimeEntryIds(t, { workItems, backlogs, timeEntries })) {
          if (!seen.has(id)) { seen.add(id); entryIds.push(id); }
        }
      }
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

