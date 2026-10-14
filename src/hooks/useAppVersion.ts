/**
 * Notices when the site has moved on to a newer build than the one on screen.
 *
 * Checked once when the app starts, then every minute while the tab is in the
 * foreground, and immediately when the tab comes back — that last one is what
 * catches a phone that has been sitting in someone's pocket while a new version
 * was published. Any failure, including a site that serves no build file at all
 * (every development server), leaves the answer at `null` and the bar hidden.
 */
import { useEffect, useState } from "react";
import { APP_BUILD, fetchLiveBuild, isNewerBuild, stripBuildMarker, type BuildInfo } from "@/lib/appVersion";

export const VERSION_CHECK_INTERVAL_MS = 60_000;

export function useAppVersion(current: BuildInfo = APP_BUILD): BuildInfo | null {
  const [live, setLive] = useState<BuildInfo | null>(null);

  useEffect(() => {
    stripBuildMarker();
    let cancelled = false;

    const check = async () => {
      const fetched = await fetchLiveBuild();
      if (!cancelled && fetched && isNewerBuild(fetched, current)) setLive(fetched);
    };

    void check();
    const timer = window.setInterval(() => {
      if (!document.hidden) void check();
    }, VERSION_CHECK_INTERVAL_MS);
    // Coming back to the tab means the app has been out of sight, which is
    // exactly when a deployment is most likely to have slipped past it.
    const onVisibility = () => void check();
    document.addEventListener("visibilitychange", onVisibility);

    return () => {
      cancelled = true;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisibility);
    };
  }, [current]);

  return live;
}
