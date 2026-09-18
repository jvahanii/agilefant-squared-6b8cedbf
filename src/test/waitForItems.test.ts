/**
 * Auto-place ranked its lists before the imported items had loaded, so the new
 * ones landed at the end. It now waits for them first.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

let items: Record<string, unknown> = {};
vi.mock("@/store/appStore", () => ({ useAppStore: { getState: () => ({ workItems: items }) } }));

import { waitForItems } from "@/lib/waitForItems";

beforeEach(() => {
  items = {};
});

describe("waitForItems", () => {
  it("resolves at once when the items are already there", async () => {
    items = { a: {} };
    const reload = vi.fn().mockResolvedValue(undefined);
    expect(await waitForItems(["a"], reload)).toBe(true);
    expect(reload).not.toHaveBeenCalled();
  });

  it("asks for a reload, and resolves when the items arrive", async () => {
    const reload = vi.fn(async () => {
      // As a background refresh does: the data lands after the call returns.
      setTimeout(() => (items = { a: {}, b: {} }), 20);
    });
    expect(await waitForItems(["a", "b"], reload, { pollMs: 5 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it("asks again when the first reload brought nothing new", async () => {
    let calls = 0;
    const reload = vi.fn(async () => {
      calls++;
      if (calls === 2) items = { a: {} };
    });
    expect(await waitForItems(["a"], reload, { pollMs: 2, reloadEveryMs: 10, timeoutMs: 1000 })).toBe(true);
    expect(reload).toHaveBeenCalledTimes(2);
  });

  it("gives up after the timeout, saying so", async () => {
    const reload = vi.fn().mockResolvedValue(undefined);
    expect(await waitForItems(["never"], reload, { pollMs: 2, reloadEveryMs: 10, timeoutMs: 40 })).toBe(false);
  });
});
