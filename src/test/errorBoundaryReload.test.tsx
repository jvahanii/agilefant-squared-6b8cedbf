/**
 * The auto-reload that recovers from a stale build must not become a reload
 * loop. On 2026-09-14 it did: the guard was a boolean cleared in
 * componentDidMount, and since the boundary mounts before its children fail,
 * every reload disarmed the guard. The page reloaded forever and there was no
 * window in which to open devtools or clear the cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ErrorBoundary, RELOAD_COOLDOWN_MS } from "@/components/ErrorBoundary";

const CHUNK_ERROR = "Failed to fetch dynamically imported module: /assets/Index-DY3qiVj0.js";

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

let reload: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  reload = vi.fn();
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload },
  });
  // React logs caught errors; keep the output readable.
  vi.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  vi.restoreAllMocks();
});

/** A fresh boundary, as a real page reload would produce. sessionStorage persists. */
const mountAfterReload = (message = CHUNK_ERROR) =>
  render(
    <ErrorBoundary>
      <Boom message={message} />
    </ErrorBoundary>,
  ).unmount();

describe("chunk-error auto-reload", () => {
  it("reloads once when a lazy chunk fails", () => {
    mountAfterReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("does not reload again when the reloaded page fails the same way", () => {
    // This is the loop. Each iteration is a fresh boundary with the same
    // failure; only the timestamp in sessionStorage carries across.
    mountAfterReload();
    mountAfterReload();
    mountAfterReload();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("offers the hard refresh once reloading has been tried and failed", () => {
    mountAfterReload();
    render(
      <ErrorBoundary>
        <Boom message={CHUNK_ERROR} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/hard refresh/i)).toBeTruthy();
    expect(screen.getByText(/Ctrl/)).toBeTruthy();
  });

  it("allows another reload once the cooldown has passed", () => {
    mountAfterReload();
    sessionStorage.setItem(
      ErrorBoundary.RELOAD_KEY,
      String(Date.now() - RELOAD_COOLDOWN_MS - 1_000),
    );
    mountAfterReload();
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("never reloads for an ordinary rendering error", () => {
    mountAfterReload("Cannot read properties of undefined (reading 'map')");
    expect(reload).not.toHaveBeenCalled();
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'map')" />
      </ErrorBoundary>,
    );
    expect(screen.queryByText(/hard refresh/i)).toBeNull();
  });

  it("does not reload when sessionStorage is unavailable", () => {
    // Private windows and blocked site data throw here. Failing open would be
    // an unguarded loop, so the boundary must fail closed.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mountAfterReload();
    expect(reload).not.toHaveBeenCalled();
  });

  it("shows the error message either way", () => {
    render(
      <ErrorBoundary>
        <Boom message={CHUNK_ERROR} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
  });
});
