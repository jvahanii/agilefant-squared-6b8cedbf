import { useEffect } from "react";
import { Loader2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";

/**
 * What may not reach the app while it is catching up. Scrolling is not in
 * the list: a finger on the screen still moves the page.
 */
const HELD_BACK = ["click", "dblclick", "contextmenu", "keydown", "dragstart", "pointerdown", "mousedown", "touchstart"] as const;
/** Stopped from reaching the app, but left to do what the browser does with
 *  them — which for a touch is to scroll. */
const LEFT_TO_THE_BROWSER = new Set<string>(["pointerdown", "mousedown", "touchstart"]);

/**
 * Holds edits back while the app shows a copy of the data it kept from an
 * earlier visit and the current one is on its way.
 *
 * Starting from the kept copy is what makes a start instant: the items are
 * on the screen before anything has been fetched. But a copy from yesterday
 * is for looking at. Every save writes a whole item, so marking one done
 * from yesterday's copy would write yesterday's name and description back
 * over whatever was changed since on another device. So until the fresh
 * data has landed — a second or two — the page can be read and scrolled and
 * nothing in it can be changed, and a small note says why taps do nothing.
 *
 * The store lets go by itself if the refresh has not come back in a while,
 * so being offline does not leave the app locked.
 */
export function CatchingUpGuard() {
  const catchingUp = useAppStore((s) => s.catchingUp);

  useEffect(() => {
    if (!catchingUp) return;
    const hold = (e: Event) => {
      e.stopPropagation();
      if (e.cancelable && !LEFT_TO_THE_BROWSER.has(e.type)) e.preventDefault();
    };
    // On the window, capturing: ahead of every handler in the app.
    for (const type of HELD_BACK) window.addEventListener(type, hold, true);
    return () => {
      for (const type of HELD_BACK) window.removeEventListener(type, hold, true);
    };
  }, [catchingUp]);

  if (!catchingUp) return null;
  return (
    <div
      role="status"
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 top-2 z-[100] flex justify-center"
    >
      <span className="flex items-center gap-1.5 rounded-full border bg-background/95 px-3 py-1 text-xs text-muted-foreground shadow-sm">
        <Loader2 className="h-3 w-3 animate-spin" />
        Updating…
      </span>
    </div>
  );
}
