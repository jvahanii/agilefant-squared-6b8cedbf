/**
 * The bar that offers to reload into a newer build.
 *
 * It has to stay silent unless the site really is running something else. Two
 * ways it used to be able to lie: a development server has no build file at all,
 * and the SPA fallback answers that missing file with `index.html` and a status
 * 200 — which looks exactly like a successful request for a new version.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, act, waitFor } from "@testing-library/react";

import { UpdateBanner } from "@/components/UpdateBanner";
import type { BuildInfo, BuildNavigator } from "@/lib/appVersion";

const CURRENT: BuildInfo = { commit: "aaa111", builtAt: "2026-10-14T12:00:00.000Z" };
const NEWER: BuildInfo = { commit: "bbb222", builtAt: "2026-10-14T12:30:00.000Z" };

const jsonResponse = (body: unknown) => ({
  ok: true,
  headers: { get: () => "application/json" },
  json: async () => body,
});

/** What the SPA fallback returns for a path that does not exist. */
const htmlResponse = () => ({
  ok: true,
  headers: { get: () => "text/html; charset=utf-8" },
  json: async () => {
    throw new Error("<!doctype html> is not a build file");
  },
});

const serve = (response: unknown) => {
  const fetchMock = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
};

const nav = () => {
  const navigator: BuildNavigator & { reload: ReturnType<typeof vi.fn>; replace: ReturnType<typeof vi.fn> } = {
    reload: vi.fn(),
    replace: vi.fn(),
  };
  return navigator;
};

/** Lets the mount-time check finish before asserting on what it found. */
const settle = async () => {
  await act(async () => {
    // A macrotask: the check runs through `fetch` and then `json`, so a couple
    // of microtasks would leave it half done and the assertions would pass for
    // the wrong reason.
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
};

beforeEach(() => {
  sessionStorage.clear();
  window.history.replaceState(null, "", "/");
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("UpdateBanner", () => {
  it("says nothing while the site runs the same build", async () => {
    serve(jsonResponse(CURRENT));
    render(<UpdateBanner current={CURRENT} navigator={nav()} />);
    await settle();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("says nothing when the site answers with a page instead of a build file", async () => {
    serve(htmlResponse());
    render(<UpdateBanner current={CURRENT} navigator={nav()} />);
    await settle();

    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("offers to reload once the site runs a different build", async () => {
    serve(jsonResponse(NEWER));
    render(<UpdateBanner current={CURRENT} navigator={nav()} />);

    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());
    expect(screen.getByText("A newer version is here")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reload" })).toBeInTheDocument();
  });

  it("holds a dismissed bar back for that build", async () => {
    serve(jsonResponse(NEWER));
    render(<UpdateBanner current={CURRENT} navigator={nav()} />);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Dismiss" }));
    expect(screen.queryByRole("status")).not.toBeInTheDocument();

    // Coming back to the tab checks again; the same build must not raise it.
    document.dispatchEvent(new Event("visibilitychange"));
    await settle();
    expect(screen.queryByRole("status")).not.toBeInTheDocument();
  });

  it("forces a fresh document on the first update click", async () => {
    serve(jsonResponse(NEWER));
    const navigator = nav();
    render(<UpdateBanner current={CURRENT} navigator={navigator} />);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(navigator.reload).not.toHaveBeenCalled();
    expect(navigator.replace).toHaveBeenCalledTimes(1);
    const forced = new URL(navigator.replace.mock.calls[0][0] as string, "http://localhost");
    expect(forced.searchParams.get("v")).toBe(NEWER.builtAt);
  });

  it("does not force an address that was forced already", async () => {
    window.history.replaceState(null, "", `/?v=${encodeURIComponent(NEWER.builtAt)}`);
    serve(jsonResponse(NEWER));
    const navigator = nav();
    render(<UpdateBanner current={CURRENT} navigator={navigator} />);
    await waitFor(() => expect(screen.getByRole("status")).toBeInTheDocument());

    fireEvent.click(screen.getByRole("button", { name: "Reload" }));
    expect(navigator.reload).not.toHaveBeenCalled();
    expect(navigator.replace).not.toHaveBeenCalled();
  });

  it("cleans the marker out of the address once the app is up to date", async () => {
    window.history.replaceState(null, "", "/?v=2026-10-13T09%3A00%3A00.000Z");
    serve(jsonResponse(CURRENT));
    render(<UpdateBanner current={CURRENT} navigator={nav()} />);
    await settle();

    expect(window.location.search).toBe("");
  });
});
