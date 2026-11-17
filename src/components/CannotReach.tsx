import { useEffect } from "react";
import { Button } from "@/components/ui/button";

/** Tries again by itself this often, so the app comes back when the database does. */
export const CANNOT_REACH_RETRY_MS = 15_000;

/**
 * Shown to a signed-in person whose organisations could not be loaded (see
 * orgStore's unreachable). Before this, an empty list sent them to
 * Onboarding as if their account were new (2026-11-17).
 */
export function CannotReach({ onRetry }: { onRetry: () => void }) {
  useEffect(() => {
    const timer = setInterval(onRetry, CANNOT_REACH_RETRY_MS);
    return () => clearInterval(timer);
  }, [onRetry]);

  return (
    <div className="flex h-screen items-center justify-center bg-background p-4">
      <div role="alert" className="max-w-md space-y-3 text-center">
        <h1 className="text-xl font-semibold">Agilefant can't be reached right now</h1>
        <p className="text-sm text-muted-foreground">
          Your organisations could not be loaded. Nothing is lost; this page tries again by itself every few seconds.
        </p>
        <Button type="button" onClick={onRetry}>
          Try again
        </Button>
      </div>
    </div>
  );
}
