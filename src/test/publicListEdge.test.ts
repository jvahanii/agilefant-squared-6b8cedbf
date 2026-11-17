/**
 * A public list answered by Cloudflare (functions/api/public-list/[token].ts,
 * 2026-11-17): the database is asked at most once a minute per location,
 * however many visitors open or refresh the page.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  onRequestGet,
  SUPABASE_PUBLISHABLE_KEY,
  SUPABASE_URL,
  FRESH_SECONDS,
  SPARE_SECONDS,
} from "../../functions/api/public-list/[token]";
import { askCloudflare, spreadWait } from "@/lib/publicBacklog";

const TOKEN = "abcdefghijklmnopqrstuvwxyz012345";

class FakeCache {
  store = new Map<string, { body: string; maxAge: number }>();
  async match(key: Request) {
    const hit = this.store.get(key.url);
    return hit ? new Response(hit.body) : undefined;
  }
  async put(key: Request, response: Response) {
    const maxAge = Number(/max-age=(\d+)/.exec(response.headers.get("Cache-Control") ?? "")?.[1]);
    this.store.set(key.url, { body: await response.text(), maxAge });
  }
  /** The fresh copy has run out. */
  expireFresh() {
    for (const key of [...this.store.keys()]) if (key.includes("/fresh/")) this.store.delete(key);
  }
}

let cache: FakeCache;
let asked: string[];
let database: "up" | "down" | "no features";
let waiting: Promise<unknown>[];

const visit = (token = TOKEN) =>
  onRequestGet({
    request: new Request(`https://agilefant.org/api/public-list/${token}`),
    params: { token },
    waitUntil: (p) => void waiting.push(p),
  });

beforeEach(() => {
  cache = new FakeCache();
  asked = [];
  database = "up";
  waiting = [];
  vi.stubGlobal("caches", { default: cache });
  vi.stubGlobal("fetch", async (url: string) => {
    const fn = url.split("/rpc/")[1];
    asked.push(fn);
    await new Promise((r) => setTimeout(r, 5));
    if (database === "down") return new Response("{}", { status: 503 });
    if (fn === "get_published_link_features") {
      return database === "no features" ? new Response("{}", { status: 500 }) : Response.json({ jobFilters: true });
    }
    return Response.json({ kind: "tree", items: [] });
  });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

const settle = () => Promise.all(waiting);

describe("the public list at Cloudflare", () => {
  it("asks the database once, then gives the kept copy for a minute", async () => {
    const first = await (await visit()).json();
    await settle();
    expect(first.list).toEqual({ kind: "tree", items: [] });
    expect(first.features).toEqual({ jobFilters: true });
    expect(asked).toEqual(["get_published_backlog", "get_published_link_features"]);

    for (let i = 0; i < 20; i++) await visit();
    expect(asked).toHaveLength(2);
    expect([...cache.store.values()].map((v) => v.maxAge).sort((a, b) => a - b)).toEqual([
      FRESH_SECONDS,
      FRESH_SECONDS + SPARE_SECONDS,
    ]);
  });

  it("has visitors who arrive together share one ask", async () => {
    await Promise.all(Array.from({ length: 10 }, () => visit()));
    expect(asked).toHaveLength(2);
  });

  it("tells the browser not to keep it, so Refresh always comes here", async () => {
    expect((await visit()).headers.get("Cache-Control")).toBe("no-store");
  });

  it("gives the older copy, marked, while the database does not answer", async () => {
    await visit();
    await settle();
    cache.expireFresh();
    database = "down";
    const answer = await (await visit()).json();
    expect(answer.spare).toBe(true);
    expect(answer.list).toEqual({ kind: "tree", items: [] });
    expect(typeof answer.at).toBe("string");
  });

  it("answers 503 when the database does not answer and nothing is kept, so the page asks it itself", async () => {
    database = "down";
    expect((await visit()).status).toBe(503);
  });

  it("does not keep an answer whose features did not come", async () => {
    database = "no features";
    const answer = await (await visit()).json();
    await settle();
    expect(answer.list).toEqual({ kind: "tree", items: [] });
    expect(answer.features).toBeNull();
    expect(cache.store.size).toBe(0);
  });

  it("does not ask the database about something that is not a link", async () => {
    const answer = await (await visit("../../etc")).json();
    expect(answer.list).toBeNull();
    expect(asked).toEqual([]);
  });

  it("asks as the app does, with its own address and publishable key", () => {
    const client = readFileSync(join(process.cwd(), "src/integrations/supabase/client.ts"), "utf8");
    expect(client).toContain(`"${SUPABASE_URL}"`);
    expect(client).toContain(`"${SUPABASE_PUBLISHABLE_KEY}"`);
  });
});

describe("the page asking Cloudflare", () => {
  it("takes the list Cloudflare gives", async () => {
    vi.stubGlobal("fetch", async () => Response.json({ list: { kind: "tree" }, features: null, at: "2026-11-17T09:00:00Z" }));
    expect(await askCloudflare(TOKEN)).toEqual({ list: { kind: "tree" }, features: null, at: "2026-11-17T09:00:00Z", spare: false });
  });

  it("asks the database itself when Cloudflare cannot help, or is not there", async () => {
    vi.stubGlobal("fetch", async () => new Response("{}", { status: 503, headers: { "Content-Type": "application/json" } }));
    expect(await askCloudflare(TOKEN)).toBeNull();
    // The development server answers with the app's own page.
    vi.stubGlobal("fetch", async () => new Response("<!doctype html>", { headers: { "Content-Type": "text/html" } }));
    expect(await askCloudflare(TOKEN)).toBeNull();
    vi.stubGlobal("fetch", async () => {
      throw new TypeError("Failed to fetch");
    });
    expect(await askCloudflare(TOKEN)).toBeNull();
  });
});

describe("asking again after a failure", () => {
  it("waits from three quarters to one and a quarter of the wait, so visitors spread out", () => {
    expect(spreadWait(4000, () => 0)).toBe(3000);
    expect(spreadWait(4000, () => 0.5)).toBe(4000);
    expect(spreadWait(4000, () => 0.999999)).toBe(5000);
  });
});
