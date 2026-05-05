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
          // Compute next due time: lastTriggeredAt + intervalDays, then align to
          // respawnHour:respawnMinute on that day.  Aligning via setHours ensures
          // catch-up if the app was closed during the exact scheduled time.
          // If setHours moves the date backward (last trigger was after the
          // scheduled time), advance by one day so the effective interval is
          // never shorter than intervalDays.
          const minute = item.respawnMinute ?? 0;
          const baseNextDue = new Date(
            new Date(item.respawnLastTriggeredAt).getTime() +
              item.respawnIntervalDays * 24 * 60 * 60 * 1000,
          );
          const nextDue = new Date(baseNextDue);
          nextDue.setHours(item.respawnHour, minute, 0, 0);
          if (nextDue < baseNextDue) {
            nextDue.setDate(nextDue.getDate() + 1);
          }
          if (now < nextDue) return;
        } else {
          // First trigger: only fire once we reach the configured time of day.
          const minute = item.respawnMinute ?? 0;
          const nowMinutes = now.getHours() * 60 + now.getMinutes();
          const scheduledMinutes = item.respawnHour * 60 + minute;
          if (nowMinutes < scheduledMinutes) return;
        }

        respawnItem(item.id);
      });
    };

    runCheck();
    const id = setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [respawnItem]);
}
