/**
 * The auto-reload that recovers from a stale build must not become a reload
 * loop. On 2026-09-14 it did: the guard was a boolean cleared in
 * componentDidMount, and since the boundary mounts before its children fail,
 * every reload disarmed the guard. The page reloaded forever and there was no
 * window in which to open devtools or clear the cache.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ErrorBoundary, RELOAD_COOLDOWN_MS } from "@/components/ErrorBoundary";

// What was done before each reload: the cached files put right first.
const steps: string[] = [];
vi.mock("@/lib/repairAssetCache", () => ({
  repairAssetCache: async (urls: string[]) => {
    steps.push(`repair ${urls.join(",")}`);
    return [];
  },
}));

/** Lets the repair finish and the reload that follows it happen. */
const settle = () => new Promise((resolve) => setTimeout(resolve, 0));

const CHUNK_ERROR = "Failed to fetch dynamically imported module: /assets/Index-DY3qiVj0.js";

function Boom({ message }: { message: string }): never {
  throw new Error(message);
}

let reload: ReturnType<typeof vi.fn>;
let replace: ReturnType<typeof vi.fn>;

beforeEach(() => {
  sessionStorage.clear();
  steps.length = 0;
  reload = vi.fn();
  replace = vi.fn(() => steps.push("reload"));
  Object.defineProperty(window, "location", {
    configurable: true,
    value: { ...window.location, reload, replace },
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
  it("reloads once when a lazy chunk fails", async () => {
    mountAfterReload();
    await settle();
    expect(replace).toHaveBeenCalledTimes(1);
    expect(replace.mock.calls[0][0]).toMatch(/[?&]v=recovery-/);
    expect(reload).not.toHaveBeenCalled();
  });

  it("first fetches again the files the browser cached as something else", async () => {
    mountAfterReload();
    await settle();
    expect(steps).toEqual(["repair /assets/Index-DY3qiVj0.js", "reload"]);
  });

  it("does not reload again when the reloaded page fails the same way", async () => {
    // This is the loop. Each iteration is a fresh boundary with the same
    // failure; only the timestamp in sessionStorage carries across.
    mountAfterReload();
    mountAfterReload();
    mountAfterReload();
    await settle();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("manually bypasses the document cache even during the automatic cooldown", async () => {
    mountAfterReload();
    render(
      <ErrorBoundary>
        <Boom message={CHUNK_ERROR} />
      </ErrorBoundary>,
    );
    fireEvent.click(screen.getByRole("button", { name: "Load fresh version" }));
    await settle();
    expect(replace).toHaveBeenCalledTimes(2);
    expect(steps.filter((s) => s.startsWith("repair"))).toHaveLength(2);
    expect(replace.mock.calls[1][0]).toMatch(/[?&]v=recovery-/);
    expect(reload).not.toHaveBeenCalled();
  });

  it("allows another reload once the cooldown has passed", async () => {
    mountAfterReload();
    sessionStorage.setItem(
      ErrorBoundary.RELOAD_KEY,
      String(Date.now() - RELOAD_COOLDOWN_MS - 1_000),
    );
    mountAfterReload();
    await settle();
    expect(replace).toHaveBeenCalledTimes(2);
  });

  it("never reloads for an ordinary rendering error", async () => {
    mountAfterReload("Cannot read properties of undefined (reading 'map')");
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
    render(
      <ErrorBoundary>
        <Boom message="Cannot read properties of undefined (reading 'map')" />
      </ErrorBoundary>,
    );
    expect(screen.queryByText(/hard refresh/i)).toBeNull();
  });

  it("does not reload when sessionStorage is unavailable", async () => {
    // Private windows and blocked site data throw here. Failing open would be
    // an unguarded loop, so the boundary must fail closed.
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    mountAfterReload();
    await settle();
    expect(reload).not.toHaveBeenCalled();
    expect(replace).not.toHaveBeenCalled();
  });

  it("still allows manual recovery when session storage is blocked", async () => {
    vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("blocked");
    });
    render(<ErrorBoundary><Boom message={CHUNK_ERROR} /></ErrorBoundary>);
    fireEvent.click(screen.getByRole("button", { name: "Load fresh version" }));
    await settle();
    expect(replace).toHaveBeenCalledTimes(1);
  });

  it("shows the error message either way", async () => {
    render(
      <ErrorBoundary>
        <Boom message={CHUNK_ERROR} />
      </ErrorBoundary>,
    );
    expect(screen.getByText(/Something went wrong/i)).toBeTruthy();
  });
});
