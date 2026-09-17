// Fetches a job posting with the browser's own network identity and cookies.
//
// Jobly sits behind Cloudflare, which answers Agilefant's servers with a bot
// check. The same page loads normally in the user's browser, so the app asks
// this extension to read it instead.
//
// Deliberately narrow:
//   - only https pages on the hosts below — the same list as host_permissions —
//     so even a compromised page could not use this to reach anything else;
//   - GET only, nothing sent but the URL;
//   - one request at a time, with a pause between requests to the same host, so
//     a backlog of postings reads like a person clicking through them.

const ALLOWED_HOSTS = new Set(["www.jobly.fi"]);
const TIMEOUT_MS = 15_000;
const MIN_GAP_MS = 1_000;
const MAX_HTML = 2_000_000;

const lastRequestAt = new Map();
let queue = Promise.resolve();

function allowed(rawUrl) {
  try {
    const url = new URL(rawUrl);
    return url.protocol === "https:" && ALLOWED_HOSTS.has(url.hostname);
  } catch {
    return false;
  }
}

async function read(rawUrl) {
  if (!allowed(rawUrl)) return { error: "host_not_allowed" };
  const host = new URL(rawUrl).hostname;
  const wait = (lastRequestAt.get(host) ?? 0) + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  lastRequestAt.set(host, Date.now());

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(rawUrl, { credentials: "include", redirect: "follow", signal: controller.signal });
    const html = (await res.text()).slice(0, MAX_HTML);
    return { status: res.status, contentType: res.headers.get("content-type") ?? "", html };
  } catch (e) {
    return { error: e && e.name === "AbortError" ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  // Only this extension's own content script, which runs only on Agilefant.
  if (sender.id !== chrome.runtime.id || !message || message.type !== "read-posting") return false;
  const job = queue.then(() => read(String(message.url ?? "")));
  queue = job.catch(() => undefined);
  job.then(sendResponse, () => sendResponse({ error: "failed" }));
  return true; // answered asynchronously
});
