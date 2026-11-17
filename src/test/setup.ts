import "@testing-library/jest-dom";
// jsdom ships no IndexedDB, which is where the app-data cache lives. Without
// this the cache silently no-ops under test and its behaviour goes uncovered.
import "fake-indexeddb/auto";
import { beforeEach } from "vitest";
import { clearAllCachedAppData } from "@/store/appDataCache";
import { forgetRowMirrors } from "@/store/rowMirror";
import { forgetItemChanges } from "@/lib/itemChangedAt";
import { forgetLoadExtras } from "@/store/loadExtras";
import { forgetTreeShares } from "@/store/treeSharesStore";
import { forgetSuperuser } from "@/lib/superuser";

// Unlike localStorage, the cache survives between tests in a file, so without
// this one test's snapshot sends the next one down the cached load path.
// Likewise the kept rows, or a test's load would only ask for changes.
beforeEach(async () => {
  await clearAllCachedAppData();
  await forgetRowMirrors();
  forgetItemChanges();
  forgetLoadExtras();
  forgetTreeShares();
  forgetSuperuser();
});

// Tests never reach the live database. The client's address is the real one
// (src/integrations/supabase/client.ts), so a test that did not mock it sent
// its requests to production, from every run here and in CI: Postgres logged
// "invalid input syntax for type uuid: perf-test" and the like, and live-update
// sockets opened there too (found 2026-11-17, while the database was down).
// Any request to a Supabase address is now answered here, as unavailable, and
// sockets are a stand-in that never connects. A test that wants an answer
// mocks the client or fetch itself, as most already do.
export const NO_DATABASE_IN_TESTS = "Tests do not reach the database";
const realFetch = globalThis.fetch?.bind(globalThis);
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
  if (/\.supabase\.(co|in)\b/.test(url)) {
    return new Response(JSON.stringify({ message: NO_DATABASE_IN_TESTS, code: "TEST" }), {
      status: 503,
      headers: { "Content-Type": "application/json" },
    });
  }
  if (!realFetch) throw new Error(`No fetch in tests for ${url}`);
  return realFetch(input, init);
}) as typeof fetch;

class NoSocket {
  static CONNECTING = 0;
  static OPEN = 1;
  static CLOSING = 2;
  static CLOSED = 3;
  readyState = 0;
  url: string;
  onopen: ((e: Event) => void) | null = null;
  onclose: ((e: Event) => void) | null = null;
  onerror: ((e: Event) => void) | null = null;
  onmessage: ((e: MessageEvent) => void) | null = null;
  binaryType = "blob";
  constructor(url: string | URL) {
    this.url = String(url);
  }
  send() {}
  close() {
    this.readyState = 3;
  }
  addEventListener() {}
  removeEventListener() {}
}
for (const target of [globalThis, window] as Array<Record<string, unknown>>) {
  target.WebSocket = NoSocket;
}

Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => {},
  }),
});
