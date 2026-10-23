import { afterEach, describe, expect, it, vi } from "vitest";
import { reloadFreshPage, reloadIntoNewBuild } from "@/lib/appVersion";

afterEach(() => vi.restoreAllMocks());

describe("fresh document navigation", () => {
  it("bypasses cached HTML immediately when updating to a known build", () => {
    const nav = { reload: vi.fn(), replace: vi.fn() };
    reloadIntoNewBuild({ commit: "abc", builtAt: "2026-10-23T07:21:00Z" }, nav);
    expect(nav.reload).not.toHaveBeenCalled();
    const url = new URL(nav.replace.mock.calls[0][0], window.location.href);
    expect(url.searchParams.get("v")).toBe("2026-10-23T07:21:00Z");
  });

  it("preserves the current path, unrelated query parameters and fragment", () => {
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: {
      pathname: "/app", search: "?tree=123&v=old", hash: "#item-456",
    } });
    try {
      vi.spyOn(Date, "now").mockReturnValue(1792730460000);
      const nav = { reload: vi.fn(), replace: vi.fn() };
      reloadFreshPage(nav);
      expect(nav.replace).toHaveBeenCalledWith("/app?tree=123&v=recovery-1792730460000#item-456");
      expect(nav.reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });

  it("does not navigate repeatedly to the same known build marker", () => {
    const original = window.location;
    Object.defineProperty(window, "location", { configurable: true, value: {
      pathname: "/app", search: "?v=latest", hash: "",
    } });
    try {
      const nav = { reload: vi.fn(), replace: vi.fn() };
      reloadIntoNewBuild({ commit: "abc", builtAt: "latest" }, nav);
      expect(nav.replace).not.toHaveBeenCalled();
      expect(nav.reload).not.toHaveBeenCalled();
    } finally {
      Object.defineProperty(window, "location", { configurable: true, value: original });
    }
  });
});