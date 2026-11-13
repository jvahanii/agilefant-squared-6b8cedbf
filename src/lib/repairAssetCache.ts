/**
 * Puts right the app's files the browser has cached as something else.
 *
 * On 2026-11-13, seconds into a deploy, Cloudflare answered a request for a
 * new file (assets/index-C9wsP6Xb.js) with the app's HTML page, as it does
 * for any address it has no file for, and the browser kept that answer for
 * four hours. Every load of the app then failed on it: the retry in
 * importWithRetry asks again only for the file that reported the failure,
 * under a new address, and that file's own imports still came from the cache;
 * a reload of the page left the cached files as they were.
 *
 * So before trying again, each script and style sheet under /assets/ that the
 * page has asked for is read from the cache alone, and any that is not what
 * its name says (a page instead of a script) is fetched again past the cache,
 * which replaces the cached copy.
 */

/** How long a repair may hold up a retry or a reload. */
export const REPAIR_TIME_LIMIT_MS = 4_000;

export interface RepairEnvironment {
  /** The addresses of the files the page has asked for. */
  requested: () => string[];
  fetch: typeof fetch;
  origin: string;
}

const browserEnvironment = (): RepairEnvironment => ({
  requested: () => {
    const urls: string[] = [];
    try {
      for (const entry of performance.getEntriesByType("resource")) urls.push(entry.name);
    } catch {
      // No timing entries: the elements below still name the files the page started with.
    }
    document.querySelectorAll<HTMLScriptElement>("script[src]").forEach((s) => urls.push(s.src));
    document.querySelectorAll<HTMLLinkElement>("link[href]").forEach((l) => urls.push(l.href));
    return urls;
  },
  fetch: (input, init) => fetch(input, init),
  origin: window.location.origin,
});

/** The content type a file of this name should have; null for files not checked. */
function expectedType(path: string): RegExp | null {
  if (path.endsWith(".js")) return /javascript/i;
  if (path.endsWith(".css")) return /css/i;
  return null;
}

/** The app's own built files among these addresses, without query strings, once each. */
export function appAssets(urls: Iterable<string>, origin: string): string[] {
  const assets = new Set<string>();
  for (const raw of urls) {
    let url: URL;
    try {
      url = new URL(raw, origin);
    } catch {
      continue;
    }
    if (url.origin !== origin || !url.pathname.startsWith("/assets/") || !expectedType(url.pathname)) continue;
    assets.add(url.origin + url.pathname);
  }
  return [...assets];
}

/**
 * Fetches again every cached app file that is not what its name says, and
 * gives the ones it fetched. Never throws, and gives up after the time limit.
 */
export async function repairAssetCache(
  extraUrls: readonly string[] = [],
  env: RepairEnvironment = browserEnvironment(),
  timeLimitMs: number = REPAIR_TIME_LIMIT_MS,
): Promise<string[]> {
  const repaired: string[] = [];
  const work = (async () => {
    let urls: string[];
    try {
      urls = appAssets([...env.requested(), ...extraUrls], env.origin);
    } catch {
      return;
    }
    await Promise.all(
      urls.map(async (url) => {
        try {
          const cached = await env.fetch(url, { cache: "only-if-cached", mode: "same-origin" });
          const type = cached.headers.get("content-type") ?? "";
          if (cached.ok && expectedType(new URL(url).pathname)!.test(type)) return;
          const fresh = await env.fetch(url, { cache: "reload" });
          await fresh.arrayBuffer().catch(() => undefined);
          repaired.push(url);
        } catch {
          // Not in the cache (only-if-cached rejects), or the network failed:
          // nothing cached to put right, or nothing to put it right with.
        }
      }),
    );
  })();
  let timer: ReturnType<typeof setTimeout> | undefined;
  await Promise.race([work, new Promise<void>((resolve) => { timer = setTimeout(resolve, timeLimitMs); })]);
  clearTimeout(timer);
  if (repaired.length > 0) console.warn("Fetched again app files the browser had cached as something else:", repaired);
  return repaired;
}
