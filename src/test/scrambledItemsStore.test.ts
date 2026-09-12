/**
 * Which items are scrambled, and by whom.
 *
 * The store deliberately holds no original titles: `original_title` is not
 * granted to any client role, so the query names its columns and the real name
 * only ever arrives from reveal_scrambled_title(), against a PIN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const select = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => ({ select: (cols: string) => select(table, cols) }) },
}));

import { useScrambledItemsStore, SCRAMBLE_RELOAD_DEBOUNCE_MS } from "@/store/scrambledItemsStore";

beforeEach(() => {
  select.mockReset();
  useScrambledItemsStore.setState({ byItem: new Map() });
});

describe("scrambled items store", () => {
  it("loads who scrambled what, asking only for the columns it may read", async () => {
    select.mockResolvedValue({
      data: [
        { work_item_id: "wi-1", scrambled_by: "user-a" },
        { work_item_id: "wi-2", scrambled_by: null },
      ],
      error: null,
    });

    await useScrambledItemsStore.getState().load();

    expect(select).toHaveBeenCalledWith("work_item_scrambles", "work_item_id, scrambled_by");
    const { byItem } = useScrambledItemsStore.getState();
    expect(byItem.get("wi-1")).toBe("user-a");
    // A deleted profile leaves the item scrambled, with nobody able to open it.
    expect(byItem.has("wi-2")).toBe(true);
    expect(byItem.get("wi-2")).toBeNull();
  });

  it("keeps what it has when the query fails", async () => {
    useScrambledItemsStore.getState().setScrambled("wi-1", "user-a");
    const error = vi.spyOn(console, "error").mockImplementation(() => {});
    select.mockResolvedValue({ data: null, error: { message: "offline" } });

    await useScrambledItemsStore.getState().load();

    expect(useScrambledItemsStore.getState().byItem.get("wi-1")).toBe("user-a");
    error.mockRestore();
  });

  it("reflects a scramble and an unscramble made in this tab", () => {
    const store = useScrambledItemsStore.getState();
    store.setScrambled("wi-1", "user-a");
    expect(useScrambledItemsStore.getState().byItem.get("wi-1")).toBe("user-a");

    store.setScrambled("wi-1", undefined);
    expect(useScrambledItemsStore.getState().byItem.has("wi-1")).toBe(false);
  });

  it("does not touch state when nothing changes", () => {
    useScrambledItemsStore.getState().setScrambled("wi-1", "user-a");
    const before = useScrambledItemsStore.getState().byItem;

    useScrambledItemsStore.getState().setScrambled("wi-1", "user-a");
    expect(useScrambledItemsStore.getState().byItem).toBe(before);

    useScrambledItemsStore.getState().setScrambled("wi-2", undefined);
    expect(useScrambledItemsStore.getState().byItem).toBe(before);
  });

  it("coalesces a burst of change events into one query", async () => {
    vi.useFakeTimers();
    select.mockResolvedValue({ data: [], error: null });

    const store = useScrambledItemsStore.getState();
    store.scheduleLoad();
    store.scheduleLoad();
    store.scheduleLoad();
    expect(select).not.toHaveBeenCalled();

    vi.advanceTimersByTime(SCRAMBLE_RELOAD_DEBOUNCE_MS);
    expect(select).toHaveBeenCalledTimes(1);
    vi.useRealTimers();
  });
});

afterEach(() => {
  vi.useRealTimers();
});
