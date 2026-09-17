import { factsFromPage, type PostingFacts } from "../../supabase/functions/_shared/fetchDeadline";

/**
 * Reading job postings through the user's own browser, for the boards that
 * refuse Agilefant's servers.
 *
 * Jobly answers every Supabase server with Cloudflare's "Just a moment…" check,
 * so the edge functions never see a Jobly posting and none ever got a deadline.
 * The posting reader extension (extension/posting-reader) fetches the page in
 * the browser instead, and the page is judged here by the same factsFromPage the
 * server uses.
 *
 * The extension is optional: without it everything here answers "not
 * available" and callers carry on as before.
 */

const APP = "agilefant-app";
const READER = "agilefant-posting-reader";

/** Hosts the extension may read. Must match its manifest and background.js. */
const BROWSER_HOSTS = new Set(["www.jobly.fi", "jobly.fi"]);

/** Should this posting be read through the browser rather than by the server? */
export function readableInBrowser(rawUrl: string): boolean {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && BROWSER_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

/** The extension fetches www.jobly.fi; a bare jobly.fi link is the same page. */
function browserTarget(rawUrl: string): string {
  const url = new URL(rawUrl);
  if (url.hostname === "jobly.fi") url.hostname = "www.jobly.fi";
  return url.toString();
}

let ready = false;
const readyWaiters = new Set<() => void>();
const pending = new Map<string, (answer: ReaderAnswer) => void>();

interface ReaderAnswer {
  status?: number;
  contentType?: string;
  html?: string;
  error?: string;
}

let listening = false;
function listen() {
  if (listening || typeof window === "undefined") return;
  listening = true;
  window.addEventListener("message", (event: MessageEvent) => {
    if (event.source !== window) return;
    const data = event.data;
    if (!data || data.source !== READER) return;
    if (data.type === "ready") {
      ready = true;
      readyWaiters.forEach((wake) => wake());
      readyWaiters.clear();
    } else if (data.type === "posting" && typeof data.id === "string") {
      const resolve = pending.get(data.id);
      if (!resolve) return;
      pending.delete(data.id);
      resolve(data as ReaderAnswer);
    }
  });
}
listen();

/** Is the extension installed and answering on this page? */
export async function postingReaderAvailable(timeoutMs = 600): Promise<boolean> {
  listen();
  if (ready) return true;
  if (typeof window === "undefined") return false;
  return new Promise<boolean>((resolve) => {
    const wake = () => {
      clearTimeout(timer);
      resolve(true);
    };
    const timer = setTimeout(() => {
      readyWaiters.delete(wake);
      resolve(ready);
    }, timeoutMs);
    readyWaiters.add(wake);
    window.postMessage({ source: APP, type: "ping" }, window.location.origin);
  });
}

/**
 * Read one posting through the extension and say what it shows.
 *
 * Never throws. A refused host, a timeout, an absent extension or a Cloudflare
 * check all come back as `unreachable` — nothing known — never as closed.
 */
export async function readPostingFacts(
  rawUrl: string,
  reference: string = new Date().toISOString(),
  timeoutMs = 30_000,
): Promise<PostingFacts> {
  if (!readableInBrowser(rawUrl) || typeof window === "undefined") return { unreachable: 0 };
  listen();
  const target = browserTarget(rawUrl);
  const id = `${Date.now()}-${Math.random().toString(36).slice(2)}`;

  const answer = await new Promise<ReaderAnswer>((resolve) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      resolve({ error: "timeout" });
    }, timeoutMs);
    pending.set(id, (a) => {
      clearTimeout(timer);
      resolve(a);
    });
    window.postMessage({ source: APP, type: "read-posting", id, url: target }, window.location.origin);
  });

  if (answer.error || typeof answer.status !== "number" || typeof answer.html !== "string") {
    return { unreachable: answer.status ?? 0 };
  }
  return factsFromPage(target, answer.status, answer.contentType ?? "", answer.html, reference);
}

/** For tests: forget what has been heard from the extension. */
export function resetPostingReaderForTests() {
  ready = false;
  pending.clear();
  readyWaiters.clear();
}
