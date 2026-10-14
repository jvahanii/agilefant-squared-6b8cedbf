/**
 * A slim bar at the bottom of the screen when the site has a newer build than
 * the one you are looking at.
 *
 * It never reloads anything by itself: the reload is a button, so nobody loses
 * a half-finished edit to a deployment. Dismissing it holds the bar back for
 * that build alone — a later build raises it again.
 *
 * `z-40` puts it above the page but below the dialogs, sheets and confirmations,
 * which are `z-50`, so it can never cover something you are mid-way through.
 */
import { useState } from "react";
import { X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useAppVersion } from "@/hooks/useAppVersion";
import { APP_BUILD, browserNavigator, reloadIntoNewBuild, type BuildInfo, type BuildNavigator } from "@/lib/appVersion";

interface UpdateBannerProps {
  navigator?: BuildNavigator;
  current?: BuildInfo;
}

export function UpdateBanner({ navigator = browserNavigator, current = APP_BUILD }: UpdateBannerProps = {}) {
  const live = useAppVersion(current);
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  if (!live || dismissedFor === live.builtAt) return null;

  return (
    <div
      role="status"
      aria-live="polite"
      className="fixed inset-x-0 bottom-0 z-40 border-t border-border bg-card px-3 pt-2 pb-[calc(0.5rem+env(safe-area-inset-bottom))] text-foreground shadow-lg"
    >
      <div className="mx-auto flex max-w-3xl items-center gap-3">
        <span className="min-w-0 flex-1 text-sm">A newer version is here</span>
        <Button size="sm" onClick={() => reloadIntoNewBuild(live, navigator)}>
          Reload
        </Button>
        <Button
          size="icon"
          variant="ghost"
          aria-label="Dismiss"
          className="h-9 w-9 shrink-0"
          onClick={() => setDismissedFor(live.builtAt)}
        >
          <X className="h-4 w-4" />
        </Button>
      </div>
    </div>
  );
}
