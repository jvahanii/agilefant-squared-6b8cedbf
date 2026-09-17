// Bridges the Agilefant page and the extension's background worker.
//
// The page cannot talk to an extension directly without knowing its id, so it
// posts a message to its own window; this script, injected only into Agilefant,
// relays it and posts the answer back. Messages from anywhere other than this
// same window are ignored.

const APP = "agilefant-app";
const READER = "agilefant-posting-reader";
const VERSION = chrome.runtime.getManifest().version;

function announce() {
  window.postMessage({ source: READER, type: "ready", version: VERSION }, window.location.origin);
}

window.addEventListener("message", (event) => {
  if (event.source !== window || event.origin !== window.location.origin) return;
  const data = event.data;
  if (!data || data.source !== APP) return;

  if (data.type === "ping") {
    announce();
    return;
  }
  if (data.type !== "read-posting" || typeof data.id !== "string") return;

  chrome.runtime.sendMessage({ type: "read-posting", url: String(data.url ?? "") }, (response) => {
    const answer = chrome.runtime.lastError ? { error: "extension_unavailable" } : response;
    window.postMessage({ source: READER, type: "posting", id: data.id, ...answer }, window.location.origin);
  });
});

announce();
