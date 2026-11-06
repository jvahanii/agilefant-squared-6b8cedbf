/**
 * When an item last changed, for the search's ordering: from the load that
 * read it, or from a later live update — including the echo of this page's own
 * save, which is not applied to the item when it changes nothing on screen.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { forgetItemChanges, itemChangedAt, noteItemChanged } from "@/lib/itemChangedAt";
import { useAppStore } from "@/store/appStore";
import type { WorkItem } from "@/types/models";

beforeEach(() => forgetItemChanges());

describe("an item's last change", () => {
  it("is the load's time until a live update brings a later one", () => {
    const item = { id: "a", changedAt: "2026-11-05T10:00:00+00:00" };
    expect(itemChangedAt(item)).toBe(Date.parse("2026-11-05T10:00:00Z"));
    noteItemChanged("a", "2026-11-05T12:00:00.5+00:00");
    expect(itemChangedAt(item)).toBe(Date.parse("2026-11-05T12:00:00.5Z"));
    // An older time arriving late changes nothing.
    noteItemChanged("a", "2026-11-05T11:00:00+00:00");
    expect(itemChangedAt(item)).toBe(Date.parse("2026-11-05T12:00:00.5Z"));
  });

  it("is read in Postgres's own format as well", () => {
    noteItemChanged("b", "2026-11-05 18:45:41.518608+00");
    expect(itemChangedAt({ id: "b" })).toBe(Date.parse("2026-11-05T18:45:41.518Z"));
  });

  it("is unknown for an item never seen changing", () => {
    expect(itemChangedAt({ id: "c" })).toBeUndefined();
  });

  it("is noted from the echo of a save that changes nothing on screen", () => {
    const item = {
      id: "e", title: "Same", status: "not_started", parentId: null, childrenIds: [],
      backlogAssignments: { t: "b" }, ranks: { b: 0 }, boardRanks: {}, organizationId: "org",
      respawnEnabled: false, changedAt: "2026-11-05T10:00:00+00:00",
    } as unknown as WorkItem;
    useAppStore.setState({ workItems: { e: item } } as never);
    const before = useAppStore.getState().workItems;
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", {
      id: "e", title: "Same", status: "not_started", parent_id: null, backlog_assignments: { t: "b" },
      organization_id: "org", respawn_enabled: false, changed_at: "2026-11-05T15:00:00+00:00",
    });
    // Not applied — nothing re-renders — but the search knows it changed.
    expect(useAppStore.getState().workItems).toBe(before);
    expect(itemChangedAt(item)).toBe(Date.parse("2026-11-05T15:00:00Z"));
  });
});
