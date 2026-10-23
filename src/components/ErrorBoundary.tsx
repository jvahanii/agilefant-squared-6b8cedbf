import { Component, ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { reloadFreshPage } from "@/lib/appVersion";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

/** Auto-reload at most once per this window, per tab. */
export const RELOAD_COOLDOWN_MS = 30_000;

function lastAutoReload(key: string): number {
  try {
    return Number(sessionStorage.getItem(key)) || 0;
  } catch {
    // Private mode, blocked storage: "cannot remember", which the caller turns
    // into "do not auto-reload" rather than "reload freely".
    return Number.NaN;
  }
}

function recordAutoReload(key: string): boolean {
  try {
    sessionStorage.setItem(key, String(Date.now()));
    return true;
  } catch {
    return false;
  }
}

export class ErrorBoundary extends Component<Props, State> {
  static readonly RELOAD_KEY = "chunkErrorReloadedAt";

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught a rendering error:", error, info);

    // A lazy chunk can fail to load because a deploy replaced the hashed
    // filenames this document references. Reloading picks up fresh HTML and
    // usually fixes it -- but only if the reload can actually succeed.
    const isChunkError =
      (typeof error.message === "string" &&
        (error.message.includes("Failed to fetch dynamically imported module") ||
          error.message.includes("Loading chunk") ||
          error.message.includes("is not a valid JavaScript MIME type"))) ||
      error.name === "ChunkLoadError";
    if (!isChunkError) return;

    // Rate-limit rather than allow one reload per page load.
    //
    // This guard used to be a boolean cleared in componentDidMount. That
    // defeated it: the boundary mounts before its children fail, so every
    // reload disarmed the guard and the next failure reloaded again -- an
    // endless loop, with no window to open devtools or clear the cache. A
    // timestamp survives the reload it is guarding against.
    const last = lastAutoReload(ErrorBoundary.RELOAD_KEY);
    if (Number.isNaN(last)) return; // storage unavailable: never auto-reload
    if (Date.now() - last < RELOAD_COOLDOWN_MS) return; // already tried; show the UI
    if (!recordAutoReload(ErrorBoundary.RELOAD_KEY)) return;

    reloadFreshPage();
  }

  render() {
    if (!this.state.hasError) return this.props.children;

    const message = this.state.error?.message ?? "";
    const looksLikeStaleBuild =
      message.includes("dynamically imported module") ||
      message.includes("Loading chunk") ||
      message.includes("MIME type");

    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <div className="text-center max-w-md px-4">
          <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
          {looksLikeStaleBuild ? (
            <p className="text-muted-foreground mb-4">
              An application file could not be loaded. A newer version may be available.
              Please try loading a fresh version of Agilefant.
            </p>
          ) : (
            <p className="text-muted-foreground mb-4">
              The application encountered an unexpected error. Please refresh the page to try
              again.
            </p>
          )}
          <Button
            onClick={() => looksLikeStaleBuild ? reloadFreshPage() : window.location.reload()}
          >
            {looksLikeStaleBuild ? "Load fresh version" : "Refresh Page"}
          </Button>
          {this.state.error && (
            <p className="mt-4 text-xs text-muted-foreground font-mono break-all">{message}</p>
          )}
        </div>
      </div>
    );
  }
}
