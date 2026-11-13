/**
 * App files the browser has cached as something else — the HTML page
 * Cloudflare gave for a file it did not have yet, mid-deploy — are fetched
 * again past the cache before the app tries again (2026-11-13).
 */
import { describe, it, expect, vi } from "vitest";
import { appAssets, repairAssetCache, type RepairEnvironment } from "@/lib/repairAssetCache";

const ORIGIN = "https://agilefant.org";
const response = (type: string, status = 200) =>
  new Response("x", { status, headers: { "content-type": type } });

/** A browser whose cache holds these files, with these content types. */
function environment(cache: Record<string, string>, requested: string[]) {
  const reloaded: string[] = [];
  const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    if (init?.cache === "only-if-cached") {
      if (!(url in cache)) throw new TypeError("Failed to fetch");
      return response(cache[url]);
    }
    if (init?.cache === "reload") {
      reloaded.push(url);
      return response(url.endsWith(".css") ? "text/css" : "application/javascript");
    }
    throw new Error(`unexpected fetch ${url}`);
  });
  const env: RepairEnvironment = { requested: () => requested, fetch: fetchMock as typeof fetch, origin: ORIGIN };
  return { env, reloaded, fetchMock };
}

describe("the app's cached files", () => {
  it("are fetched again when the cache holds a page in place of a script", async () => {
    const { env, reloaded } = environment(
      {
        [`${ORIGIN}/assets/index-C9wsP6Xb.js`]: "text/html; charset=utf-8",
        [`${ORIGIN}/assets/Index-Daj9N0Xj.js`]: "application/javascript",
        [`${ORIGIN}/assets/index-bA7pH5wA.css`]: "text/css",
      },
      [`${ORIGIN}/assets/index-C9wsP6Xb.js`, `${ORIGIN}/assets/index-bA7pH5wA.css`],
    );
    vi.spyOn(console, "warn").mockImplementation(() => {});
    // The file that reported the failure, under its retry address.
    const repaired = await repairAssetCache([`${ORIGIN}/assets/Index-Daj9N0Xj.js?retry=1`], env);
    expect(repaired).toEqual([`${ORIGIN}/assets/index-C9wsP6Xb.js`]);
    expect(reloaded).toEqual([`${ORIGIN}/assets/index-C9wsP6Xb.js`]);
  });

  it("are fetched again when the cache holds a failure", async () => {
    const { env, reloaded } = environment({}, []);
    env.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
      if (init?.cache === "only-if-cached") return new Response("", { status: 404, headers: { "content-type": "application/javascript" } });
      reloaded.push(String(input));
      return response("application/javascript");
    }) as typeof fetch;
    env.requested = () => [`${ORIGIN}/assets/a.js`];
    vi.spyOn(console, "warn").mockImplementation(() => {});
    expect(await repairAssetCache([], env)).toEqual([`${ORIGIN}/assets/a.js`]);
  });

  it("are left alone when they are what their names say, or not cached at all", async () => {
    const { env, reloaded } = environment(
      { [`${ORIGIN}/assets/a.js`]: "text/javascript", [`${ORIGIN}/assets/b.css`]: "text/css; charset=utf-8" },
      [`${ORIGIN}/assets/a.js`, `${ORIGIN}/assets/b.css`, `${ORIGIN}/assets/not-cached.js`],
    );
    expect(await repairAssetCache([], env)).toEqual([]);
    expect(reloaded).toEqual([]);
  });

  it("are only the app's own scripts and style sheets", () => {
    expect(
      appAssets(
        [
          `${ORIGIN}/assets/a.js?retry=5`,
          `${ORIGIN}/assets/a.js`,
          `${ORIGIN}/assets/b.css`,
          `${ORIGIN}/assets/logo.png`,
          `${ORIGIN}/version.json`,
          "https://clerk.agilefant.org/assets/clerk.js",
          "/assets/relative.js",
          "not a url ::",
        ],
        ORIGIN,
      ),
    ).toEqual([`${ORIGIN}/assets/a.js`, `${ORIGIN}/assets/b.css`, `${ORIGIN}/assets/relative.js`]);
  });

  it("do not hold up the reload for long", async () => {
    const { env } = environment({}, [`${ORIGIN}/assets/slow.js`]);
    env.fetch = (() => new Promise(() => {})) as typeof fetch;
    const started = Date.now();
    expect(await repairAssetCache([], env, 20)).toEqual([]);
    expect(Date.now() - started).toBeLessThan(1_000);
  });

  it("never fail, whatever the browser does", async () => {
    const env: RepairEnvironment = {
      requested: () => {
        throw new Error("no performance API");
      },
      fetch: vi.fn() as unknown as typeof fetch,
      origin: ORIGIN,
    };
    await expect(repairAssetCache([], env)).resolves.toEqual([]);
  });
});
