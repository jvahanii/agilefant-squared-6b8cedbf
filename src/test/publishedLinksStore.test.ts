/**
 * The sidebar's "published" markers read this store. A tree link and a backlog
 * link are different targets, so they must land in different sets — a whole
 * tree being published is not the same as one backlog in it being published.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const select = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: () => ({ select: (...args: unknown[]) => select(...args) }) },
}));

import { usePublishedLinksStore } from "@/store/publishedLinksStore";

const state = () => usePublishedLinksStore.getState();

beforeEach(() => {
  usePublishedLinksStore.setState({ trees: new Set(), backlogs: new Set() });
  select.mockReset();
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
});
