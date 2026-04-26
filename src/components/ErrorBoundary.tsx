import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  static readonly RELOAD_KEY = "chunkErrorReloaded";

  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  componentDidMount() {
    // Clear the reload guard after a successful mount so that future chunk
    // errors within the same browser session can still trigger an auto-reload.
    sessionStorage.removeItem(ErrorBoundary.RELOAD_KEY);
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught a rendering error:", error, info);

    // When a lazy-loaded chunk fails to fetch (e.g. after a new deployment
    // invalidates old hashed filenames), reload the page once so the browser
    // picks up the fresh HTML and new chunk URLs.
    const isChunkError =
      (typeof error.message === "string" &&
        (error.message.includes("Failed to fetch dynamically imported module") ||
          error.message.includes("Loading chunk") ||
          error.message.includes("is not a valid JavaScript MIME type"))) ||
      error.name === "ChunkLoadError";

    if (isChunkError) {
      if (!sessionStorage.getItem(ErrorBoundary.RELOAD_KEY)) {
        sessionStorage.setItem(ErrorBoundary.RELOAD_KEY, "1");
        window.location.reload();
      }
    }
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="flex items-center justify-center h-screen bg-background text-foreground">
          <div className="text-center max-w-md px-4">
            <h1 className="text-2xl font-semibold mb-2">Something went wrong</h1>
            <p className="text-muted-foreground mb-4">
              The application encountered an unexpected error. Please refresh the page to try again.
            </p>
            <button
              className="px-4 py-2 rounded bg-primary text-primary-foreground hover:bg-primary/90 transition-colors"
              onClick={() => window.location.reload()}
            >
              Refresh Page
            </button>
            {this.state.error && (
              <p className="mt-4 text-xs text-muted-foreground font-mono break-all">
                {this.state.error.message}
              </p>
            )}
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
