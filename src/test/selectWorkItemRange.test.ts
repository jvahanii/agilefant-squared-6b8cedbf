/**
 * A shift-click selects its whole range in one update. Item by item, a range
 * of hundreds — the closed ads at the top of a long job list, say — woke every
 * view of the selection hundreds of times, and saved the growing selection to
 * local storage as often.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { useAppStore } from "@/store/appStore";

const ORG = "org-range";
const ids = (from: number, to: number) => Array.from({ length: to - from }, (_, i) => `${ORG}::wi-${from + i}`);

beforeEach(() => {
  localStorage.clear();
  useAppStore.setState({ organizationId: ORG, selectedWorkItemIds: [] });
});

describe("selecting a range", () => {
  it("takes one update and one save, however long the range", () => {
    let updates = 0;
    const unsubscribe = useAppStore.subscribe(() => { updates++; });
    useAppStore.getState().selectWorkItemRange(ids(0, 500), false);
    unsubscribe();
    expect(updates).toBe(1);
    expect(useAppStore.getState().selectedWorkItemIds).toEqual(ids(0, 500));
    expect(JSON.parse(localStorage.getItem(`selection_${ORG}_workItemIds`)!)).toHaveLength(500);
  });

  it("replaces the selection, the range's first item first", () => {
    useAppStore.setState({ selectedWorkItemIds: [`${ORG}::wi-900`] });
    useAppStore.getState().selectWorkItemRange(ids(10, 13), false);
    expect(useAppStore.getState().selectedWorkItemIds).toEqual(ids(10, 13));
  });

  it("adds to the selection with Ctrl, keeping what is already selected once", () => {
    useAppStore.setState({ selectedWorkItemIds: [`${ORG}::wi-900`, `${ORG}::wi-11`] });
    useAppStore.getState().selectWorkItemRange(ids(10, 13), true);
    expect(useAppStore.getState().selectedWorkItemIds).toEqual([`${ORG}::wi-900`, `${ORG}::wi-11`, `${ORG}::wi-10`, `${ORG}::wi-12`]);
  });
});
