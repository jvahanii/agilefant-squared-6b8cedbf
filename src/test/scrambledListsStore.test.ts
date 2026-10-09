/**
 * Which lists are scrambled, and by whom.
 *
 * As with items, the store holds no original names: `original_name` is not
 * granted to any client role, so the query names its columns and the real
 * name only ever arrives from reveal_scrambled_backlog_name(), against a PIN.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

const select = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { from: (table: string) => ({ select: (cols: string) => select(table, cols) }) },
}));

import { useScrambledListsStore, LIST_SCRAMBLE_RELOAD_DEBOUNCE_MS } from "@/store/scrambledListsStore";

beforeEach(() => {
  select.mockReset();
  useScrambledListsStore.setState({ byList: new Map() });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("scrambled lists store", () => {
  it("loads who scrambled what, asking only for the columns it may read", async () => {
    select.mockResolvedValue({
      data: [
        { backlog_id: "bl-1", scrambled_by: "user-a", with_backlog_id: null },
        { backlog_id: "bl-2", scrambled_by: null, with_backlog_id: "bl-1" },
      ],
      error: null,
    });

    await useScrambledListsStore.getState().load();

    expect(select).toHaveBeenCalledWith("backlog_scrambles", "backlog_id, scrambled_by, with_backlog_id");
    const { byList } = useScrambledListsStore.getState();
    expect(byList.get("bl-1")).toBe("user-a");
    // A deleted profile leaves the list scrambled, with nobody able to open it.
    expect(byList.has("bl-2")).toBe(true);
    expect(byList.get("bl-2")).toBeNull();
    // A list under a scrambled one was scrambled with it.
    expect([...useScrambledListsStore.getState().withList]).toEqual([["bl-2", "bl-1"]]);
  });

  it("keeps what it has when the query fails", async () => {
    useScrambledListsStore.setState({ byList: new Map([["bl-1", "user-a"]]) });
    select.mockResolvedValue({ data: null, error: { message: "offline" } });
    const quiet = vi.spyOn(console, "error").mockImplementation(() => {});

    await useScrambledListsStore.getState().load();

    expect(useScrambledListsStore.getState().byList.get("bl-1")).toBe("user-a");
    quiet.mockRestore();
  });

  it("reloads once for a burst of change events", () => {
    vi.useFakeTimers();
    select.mockResolvedValue({ data: [], error: null });

    for (let i = 0; i < 5; i += 1) useScrambledListsStore.getState().scheduleLoad();
    expect(select).not.toHaveBeenCalled();
    vi.advanceTimersByTime(LIST_SCRAMBLE_RELOAD_DEBOUNCE_MS);
    expect(select).toHaveBeenCalledTimes(1);
  });

  it("marks and unmarks a list without a round trip, and leaves state alone when nothing changes", () => {
    const { setScrambled } = useScrambledListsStore.getState();
    setScrambled("bl-1", "user-a");
    const marked = useScrambledListsStore.getState().byList;
    expect(marked.get("bl-1")).toBe("user-a");

    setScrambled("bl-1", "user-a");
    expect(useScrambledListsStore.getState().byList).toBe(marked);

    setScrambled("bl-1", undefined);
    expect(useScrambledListsStore.getState().byList.has("bl-1")).toBe(false);
  });
});
