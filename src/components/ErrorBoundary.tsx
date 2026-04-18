import { Component, ReactNode } from "react";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, info: { componentStack: string }) {
    console.error("ErrorBoundary caught a rendering error:", error, info);
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
