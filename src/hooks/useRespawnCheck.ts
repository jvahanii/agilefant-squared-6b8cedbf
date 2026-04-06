import { useEffect, useRef } from "react";
import { useAppStore } from "@/store/appStore";

const CHECK_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

/**
 * Checks whether any work items with respawn enabled are due to spawn a copy.
 * Runs on mount and then once per hour.
 *
 * An item is considered due when:
 *   - respawnEnabled is true
 *   - respawnIntervalDays and respawnHour are set
 *   - For the first trigger: the current local hour has reached respawnHour
 *   - For subsequent triggers: now >= (lastTriggeredAt + intervalDays), aligned to
 *     respawnHour on that day. This allows catch-up if the app was not open at the
 *     exact scheduled hour.
 */
export function useRespawnCheck() {
  const respawnItem = useAppStore((s) => s.respawnItem);
  const workItemsRef = useRef(useAppStore.getState().workItems);

  // Keep ref in sync without re-subscribing
  useEffect(() => {
    return useAppStore.subscribe((state) => {
      workItemsRef.current = state.workItems;
    });
  }, []);

  useEffect(() => {
    const runCheck = () => {
      const now = new Date();

      Object.values(workItemsRef.current).forEach((item) => {
        if (!item.respawnEnabled) return;
        if (item.respawnIntervalDays == null || item.respawnHour == null) return;

        if (item.respawnLastTriggeredAt) {
          // Compute next due time: lastTriggeredAt + intervalDays, aligned to respawnHour.
          // Using setHours ensures the trigger fires even if the app was closed during the
          // exact scheduled hour (catch-up behaviour).
          const nextDue = new Date(
            new Date(item.respawnLastTriggeredAt).getTime() +
              item.respawnIntervalDays * 24 * 60 * 60 * 1000,
          );
          nextDue.setHours(item.respawnHour, 0, 0, 0);
          if (now < nextDue) return;
        } else {
          // First trigger: only fire once we reach the configured hour of day.
          if (now.getHours() < item.respawnHour) return;
        }

        respawnItem(item.id);
      });
    };

    runCheck();
    const id = setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [respawnItem]);
}
