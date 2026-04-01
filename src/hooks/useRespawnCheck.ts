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
 *   - The current local hour matches respawnHour
 *   - Either the item has never been triggered, OR the last trigger was at least
 *     respawnIntervalDays days ago
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
      const currentHour = now.getHours();

      Object.values(workItemsRef.current).forEach((item) => {
        if (!item.respawnEnabled) return;
        if (item.respawnIntervalDays == null || item.respawnHour == null) return;
        if (currentHour !== item.respawnHour) return;

        const intervalMs = item.respawnIntervalDays * 24 * 60 * 60 * 1000;

        if (item.respawnLastTriggeredAt) {
          const lastTriggered = new Date(item.respawnLastTriggeredAt).getTime();
          if (now.getTime() - lastTriggered < intervalMs) return;
        }

        respawnItem(item.id);
      });
    };

    runCheck();
    const id = setInterval(runCheck, CHECK_INTERVAL_MS);
    return () => clearInterval(id);
  }, [respawnItem]);
}
