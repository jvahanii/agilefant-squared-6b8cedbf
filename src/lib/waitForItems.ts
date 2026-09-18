import { useAppStore } from "@/store/appStore";

/**
 * Resolve once every id is in the store, asking for a reload now and then.
 *
 * A reload with cached data on screen fetches in the background, and one that
 * was already running when the import finished fetched too early to see the new
 * items — hence asking again rather than once. Resolves false if they have not
 * all arrived in time; the caller carries on regardless.
 */
export async function waitForItems(
  ids: string[],
  reload: () => Promise<void>,
  { timeoutMs = 20_000, pollMs = 250, reloadEveryMs = 4_000 } = {},
): Promise<boolean> {
  const present = () => {
    const items = useAppStore.getState().workItems ?? {};
    return ids.every((id) => items[id]);
  };
  const started = Date.now();
  let lastReload = -Infinity;
  while (!present()) {
    const elapsed = Date.now() - started;
    if (elapsed >= timeoutMs) return false;
    if (elapsed - lastReload >= reloadEveryMs) {
      lastReload = elapsed;
      await reload().catch(() => {});
      continue;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
  return true;
}
