/**
 * The sidebar's "published" markers read this store. A tree link and a backlog
 * link are different targets, so they must land in different sets — a whole
 * tree being published is not the same as one backlog in it being published.
 * Realtime change events reload it through a debounce, so a burst — deleting a
 * tree cascades to every link in it — costs one query, not one per event.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const select = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: (...args: unknown[]) => select(...args) }) },
}));

import { PUBLISHED_RELOAD_DEBOUNCE_MS, usePublishedLinksStore } from "@/store/publishedLinksStore";

const state = () => usePublishedLinksStore.getState();

beforeEach(() => {
  usePublishedLinksStore.setState({ trees: new Set(), backlogs: new Set() });
  select.mockReset();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("publishedLinksStore", () => {
  it("files tree links and backlog links separately", async () => {
    select.mockResolvedValue({
      data: [
        { tree_id: "t1", backlog_id: null },
        { tree_id: "t1", backlog_id: "b1" },
        { tree_id: "t2", backlog_id: "b2" },
      ],
      error: null,
    });
    await state().load();
    expect([...state().trees]).toEqual(["t1"]);
    expect([...state().backlogs].sort()).toEqual(["b1", "b2"]);
  });

  it("keeps what it had when loading fails", async () => {
    usePublishedLinksStore.setState({ trees: new Set(["t1"]), backlogs: new Set() });
    select.mockResolvedValue({ data: null, error: { message: "network" } });
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    await state().load();
    expect([...state().trees]).toEqual(["t1"]);
    spy.mockRestore();
  });

  it("adds and removes a target", () => {
    state().setPublished("t1", "b1", true);
    expect(state().backlogs.has("b1")).toBe(true);
    expect(state().trees.has("t1")).toBe(false);
    state().setPublished("t1", "b1", false);
    expect(state().backlogs.has("b1")).toBe(false);

    state().setPublished("t1", null, true);
    expect(state().trees.has("t1")).toBe(true);
  });

  it("leaves state untouched when nothing changes, so markers don't re-render", () => {
    state().setPublished("t1", null, true);
    const before = state().trees;
    state().setPublished("t1", null, true);
    expect(state().trees).toBe(before);
  });

  it("coalesces a burst of change events into a single reload", async () => {
    vi.useFakeTimers();
    select.mockResolvedValue({ data: [{ tree_id: "t9", backlog_id: null }], error: null });

    // Deleting a tree with several published backlogs: one event per link.
    for (let i = 0; i < 5; i++) state().scheduleLoad();
    expect(select).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PUBLISHED_RELOAD_DEBOUNCE_MS);
    expect(select).toHaveBeenCalledTimes(1);
    expect(state().trees.has("t9")).toBe(true);
  });
});
