/**
 * A lazily loaded part of the app, tried again when it fails to load.
 *
 * "Failed to fetch dynamically imported module" was shown for a file the
 * server had — a network blip, or Cloudflare not yet serving a file of the
 * version just deployed everywhere. The browser remembers a failed module
 * load, so asking again for the same address fails at once; the file is asked
 * for again under an address of its own (?retry=…), a few times, with a pause
 * between. Only when that fails too does the error go to the ErrorBoundary,
 * which reloads the page.
 *
 * The file asked for again still loads its own imports from their usual
 * addresses, so before the first retry any of them the browser has cached as
 * something else (the HTML page Cloudflare gives for a file it lacks) is
 * fetched again: see repairAssetCache.
 */
import { repairAssetCache } from "./repairAssetCache";

/** Pauses before each retry: soon, then less soon. */
export const RETRY_DELAYS_MS = [500, 1_500, 4_000];

/** The file a failed dynamic import named, as Chrome and Firefox word it; null otherwise. */
export function failedModuleUrl(error: unknown): string | null {
  const message = error instanceof Error ? error.message : String(error ?? "");
  return message.match(/(?:Failed to fetch|error loading) dynamically imported module: (\S+)/i)?.[1] ?? null;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

export function importWithRetry<T>(
  factory: () => Promise<T>,
  load: (url: string) => Promise<T> = (url) => import(/* @vite-ignore */ url) as Promise<T>,
  delays: readonly number[] = RETRY_DELAYS_MS,
  repair: (failedUrl: string) => Promise<unknown> = (failedUrl) => repairAssetCache([failedUrl]),
): () => Promise<T> {
  return async () => {
    try {
      return await factory();
    } catch (first) {
      const url = failedModuleUrl(first);
      if (!url) throw first;
      let last: unknown = first;
      await repair(url);
      for (const delay of delays) {
        await sleep(delay);
        try {
          return await load(`${url}${url.includes("?") ? "&" : "?"}retry=${Date.now()}`);
        } catch (e) {
          last = e;
        }
      }
      throw last;
    }
  };
}
