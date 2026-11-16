import { useEffect, useState } from "react";

/**
 * Putting Agilefant on a phone's home screen (2026-11-16). With no reminder
 * email, an icon among the person's apps is one of the few things that brings
 * them back. public/manifest.webmanifest names the app and its icons.
 *
 * Chrome and Edge offer the install through a beforeinstallprompt event,
 * which comes once, early, and only to a page listening for it: the listener
 * is set up as this module loads (main.tsx imports it). Safari on iPhone has
 * no such event; there it is done from the Share menu, so the page says so.
 */
interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

let deferred: InstallPromptEvent | null = null;
const listeners = new Set<() => void>();
const changed = () => listeners.forEach((l) => l());

if (typeof window !== "undefined") {
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault();
    deferred = e as InstallPromptEvent;
    changed();
  });
  window.addEventListener("appinstalled", () => {
    deferred = null;
    changed();
  });
}

/** Already opened from the home screen, as an installed app. */
export function runningInstalled(): boolean {
  if (typeof window === "undefined") return false;
  const nav = navigator as Navigator & { standalone?: boolean };
  return nav.standalone === true || window.matchMedia?.("(display-mode: standalone)").matches === true;
}

/** Safari on an iPhone or iPad, where the Share menu has "Add to Home Screen". */
export function onIosSafari(ua = typeof navigator === "undefined" ? "" : navigator.userAgent): boolean {
  const ios = /iPhone|iPad|iPod/.test(ua);
  const otherBrowser = /CriOS|FxiOS|EdgiOS|OPiOS/.test(ua);
  return ios && !otherBrowser;
}

export type InstallWay = { kind: "prompt"; install: () => Promise<boolean> } | { kind: "ios" } | null;

/** How this browser can put the app on the home screen, if it can and it is not there yet. */
export function useInstallWay(): InstallWay {
  const [, setTick] = useState(0);
  useEffect(() => {
    const l = () => setTick((t) => t + 1);
    listeners.add(l);
    return () => {
      listeners.delete(l);
    };
  }, []);
  if (runningInstalled()) return null;
  if (deferred) {
    const event = deferred;
    return {
      kind: "prompt",
      install: async () => {
        await event.prompt();
        const { outcome } = await event.userChoice;
        deferred = null;
        changed();
        return outcome === "accepted";
      },
    };
  }
  return onIosSafari() ? { kind: "ios" } : null;
}
