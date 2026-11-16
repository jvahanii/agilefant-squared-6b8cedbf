import { useEffect, useState } from "react";

/**
 * "Loading…", but only after a second: a page that loads at once never
 * flashes it, and one held up by a deploy (importWithRetry keeps trying for
 * about 90 seconds) says what it is doing instead of staying blank.
 */
export function DelayedLoading({ afterMs = 1_000 }: { afterMs?: number }) {
  const [shown, setShown] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setShown(true), afterMs);
    return () => clearTimeout(timer);
  }, [afterMs]);
  if (!shown) return null;
  return (
    <div className="flex h-screen items-center justify-center bg-background" role="status" aria-live="polite">
      <p className="text-sm text-muted-foreground">Loading…</p>
    </div>
  );
}
