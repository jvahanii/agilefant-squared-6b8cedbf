/**
 * Reading Jobly through the browser.
 *
 * Jobly answers Supabase's servers with Cloudflare's "Just a moment…" check, so
 * no Jobly posting ever got a deadline. The posting reader extension fetches the
 * page in the user's browser, and the app judges it with the same
 * factsFromPage the server uses. Fixtures are the real pages: the Alma Media
 * posting as the browser gets it, and the challenge Supabase got for it.
 */
import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { factsFromPage, isChallengePage } from "../../supabase/functions/_shared/fetchDeadline";
import {
  postingReaderAvailable,
  readableInBrowser,
  readPostingFacts,
  resetPostingReaderForTests,
} from "@/lib/postingReader";

const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", name), "utf8");
const POSTING = fixture("jobly-posting-alma-media.html");
const CHALLENGE = fixture("jobly-cloudflare-challenge.html");
const URL_ALMA = "https://www.jobly.fi/tyopaikka/senior-ai-solutions-engineer-2760006";

describe("factsFromPage", () => {
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("finds the deadline in the Jobly posting as the browser receives it", () => {
    // "applications are accepted until 11.10.2026"
    expect(factsFromPage(URL_ALMA, 200, "text/html; charset=utf-8", POSTING, "2026-09-17T07:22:14Z")).toEqual({
      deadline: "2026-10-11",
      closed: false,
    });
  });

  it("treats Cloudflare's challenge as nothing known, never as a closed ad", () => {
    expect(isChallengePage(CHALLENGE)).toBe(true);
    expect(factsFromPage(URL_ALMA, 403, "text/html", CHALLENGE, "2026-09-17")).toEqual({ unreachable: 403 });
  });

  it("does not mistake a real Jobly page, which loads Cloudflare's scripts too, for a challenge", () => {
    expect(isChallengePage(POSTING)).toBe(false);
  });

  it("still reads a 404 as a posting that is gone", () => {
    expect(factsFromPage(URL_ALMA, 404, "text/html", "", "2026-09-17")).toEqual({ closed: true });
  });
});

describe("readableInBrowser", () => {
  it("is Jobly only — never LinkedIn, never plain http", () => {
    expect(readableInBrowser(URL_ALMA)).toBe(true);
    expect(readableInBrowser("https://jobly.fi/tyopaikka/x-1")).toBe(true);
    expect(readableInBrowser("http://www.jobly.fi/tyopaikka/x-1")).toBe(false);
    expect(readableInBrowser("https://www.linkedin.com/jobs/view/4465791712")).toBe(false);
    expect(readableInBrowser("https://duunitori.fi/tyopaikat/tyo/x")).toBe(false);
    expect(readableInBrowser("not a url")).toBe(false);
  });
});

describe("the extension bridge", () => {
  let extension: ((event: MessageEvent) => void) | null = null;
  const requests: string[] = [];

  /** Stands in for extension/posting-reader/content.js. */
  function installFakeExtension(answer: (url: string) => Record<string, unknown>) {
    extension = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.source !== "agilefant-app") return;
      const reply = (message: Record<string, unknown>) =>
        window.dispatchEvent(new MessageEvent("message", { data: { source: "agilefant-posting-reader", ...message }, source: window }));
      if (data.type === "ping") setTimeout(() => reply({ type: "ready", version: "1.0.0" }), 0);
      if (data.type === "read-posting") {
        requests.push(data.url);
        setTimeout(() => reply({ type: "posting", id: data.id, ...answer(data.url) }), 0);
      }
    };
    window.addEventListener("message", extension);
  }

  // jsdom's postMessage leaves `source` empty, so the page's own messages are
  // re-dispatched here with it set, as a browser would.
  let postMessage: typeof window.postMessage;
  beforeEach(() => {
    resetPostingReaderForTests();
    requests.length = 0;
    postMessage = window.postMessage;
    window.postMessage = ((data: unknown) => {
      window.dispatchEvent(new MessageEvent("message", { data, source: window }));
    }) as typeof window.postMessage;
  });
  afterEach(() => {
    if (extension) window.removeEventListener("message", extension);
    extension = null;
    window.postMessage = postMessage;
  });

  it("says the reader is missing when nothing answers", async () => {
    expect(await postingReaderAvailable(20)).toBe(false);
  });

  it("finds the reader when the extension answers the ping", async () => {
    installFakeExtension(() => ({}));
    expect(await postingReaderAvailable(200)).toBe(true);
  });

  it("reads a posting through the extension and judges the page", async () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-09-17T10:00:00Z"));
    installFakeExtension(() => ({ status: 200, contentType: "text/html", html: POSTING }));

    const facts = await readPostingFacts("https://jobly.fi/tyopaikka/senior-ai-solutions-engineer-2760006", "2026-09-17");

    expect(facts).toEqual({ deadline: "2026-10-11", closed: false });
    // A bare jobly.fi link is fetched as www.jobly.fi, the host the extension allows.
    expect(requests).toEqual(["https://www.jobly.fi/tyopaikka/senior-ai-solutions-engineer-2760006"]);
    vi.useRealTimers();
  });

  it("never asks the extension about a host it may not read", async () => {
    installFakeExtension(() => ({ status: 200, contentType: "text/html", html: POSTING }));
    expect(await readPostingFacts("https://www.linkedin.com/jobs/view/4465791712")).toEqual({ unreachable: 0 });
    expect(requests).toEqual([]);
  });

  it("reports an error from the extension as nothing known", async () => {
    installFakeExtension(() => ({ error: "timeout" }));
    expect(await readPostingFacts(URL_ALMA)).toEqual({ unreachable: 0 });
  });

  it("gives up when the extension never answers", async () => {
    expect(await readPostingFacts(URL_ALMA, undefined, 20)).toEqual({ unreachable: 0 });
  });

  it("ignores an answer that does not come from its own window", async () => {
    // Another frame posting a forged answer must not be taken for the extension.
    const pending = readPostingFacts(URL_ALMA, undefined, 50);
    window.dispatchEvent(
      new MessageEvent("message", {
        data: { source: "agilefant-posting-reader", type: "ready" },
        source: null,
      }),
    );
    expect(await pending).toEqual({ unreachable: 0 });
    expect(await postingReaderAvailable(20)).toBe(false);
  });
});
