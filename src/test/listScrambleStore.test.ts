/**
 * Scrambling a list from its menu, and putting it back.
 *
 * The database does the scrambling — the list and its items in one
 * transaction — and is what knows whether a PIN has to be chosen first. These
 * tests pin what the app does around it: what it asks for, that this tab
 * shows the result at once, and that a list of many items goes in runs.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
const toast = vi.fn();

vi.mock("@/integrations/supabase/client", async (importOriginal) => {
  const real = await importOriginal<typeof import("@/integrations/supabase/client")>();
  (real.supabase as unknown as { rpc: unknown }).rpc = (...args: unknown[]) => rpc(...args);
  return real;
});
vi.mock("@/hooks/use-toast", () => ({ toast: (...args: unknown[]) => toast(...args) }));
vi.mock("@/store/appDataCache", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/store/appDataCache")>()),
  patchCachedWorkItems: vi.fn(),
}));

import { useAppStore } from "@/store/appStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { useScrambledListsStore } from "@/store/scrambledListsStore";
import { refuseRenameOfScrambledList, useListScrambleStore } from "@/store/listScrambleStore";
import { setCurrentUser } from "@/lib/currentUser";
import { scrambleName } from "@/lib/scramble";
import { SCRAMBLE_CHUNK } from "@/lib/listScramble";
import type { Backlog, WorkItem } from "@/types/models";

const ME = "me";
const TREE = "org::bt-1";
const LIST = "org::bl-1";
const SUB = "org::bl-2";

const backlog = (id: string, name: string, childrenIds: string[] = [], parentId: string | null = null): Backlog => ({
  id, name, parentId, childrenIds, treeId: TREE, rank: 0,
});
const workItem = (id: string, title: string, listId: string): WorkItem =>
  ({
    id, title, parentId: null, done: false, childrenIds: [],
    backlogAssignments: { [TREE]: listId }, ranks: { [listId]: 0 }, organizationId: "org",
  }) as unknown as WorkItem;

/** What the database answers a scramble with: everything it was sent. */
const scrambledAll = (_fn: string, args: { _lists: { id: string }[]; _items: { id: string }[] }) =>
  Promise.resolve({
    data: { lists: args._lists.map((l) => l.id), items: args._items.map((i) => i.id) },
    error: null,
  });

const titles = () => {
  const s = useAppStore.getState();
  return {
    ...Object.fromEntries(Object.values(s.backlogs).map((b) => [b.id, b.name])),
    ...Object.fromEntries(Object.values(s.workItems).map((w) => [w.id, w.title])),
  };
};

beforeEach(() => {
  rpc.mockReset();
  toast.mockReset();
  setCurrentUser({ id: ME, email: null, fullName: null, avatarUrl: null });
  useScrambledListsStore.setState({ byList: new Map(), withList: new Map() });
  useScrambledItemsStore.setState({ byItem: new Map(), withList: new Map() });
  useListScrambleStore.setState({ prompt: null });
  useAppStore.setState({
    organizationId: "org",
    backlogs: {
      [LIST]: backlog(LIST, "Offers to answer", [SUB]),
      [SUB]: backlog(SUB, "By Friday", [], LIST),
    },
    workItems: {
      a: workItem("a", "Call the lawyer", LIST),
      b: workItem("b", "Answer Nordea", SUB),
    },
  });
});

describe("scrambling a list", () => {
  it("sends the list, the lists under it and their items in one call, and asks for no PIN where there is one", async () => {
    rpc.mockImplementation(scrambledAll);
    await useListScrambleStore.getState().scramble(LIST);

    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("scramble_names", {
      _lists: [
        { id: LIST, name: scrambleName("Offers to answer") },
        { id: SUB, name: scrambleName("By Friday") },
      ],
      _items: [
        { id: "a", title: scrambleName("Call the lawyer") },
        { id: "b", title: scrambleName("Answer Nordea") },
      ],
      _pin: null,
      _with_list: LIST,
    });
    expect(useListScrambleStore.getState().prompt).toBeNull();
  });

  it("shows the scrambled names in this tab at once, and marks them as this person's", async () => {
    rpc.mockImplementation(scrambledAll);
    await useListScrambleStore.getState().scramble(LIST);

    expect(titles()).toEqual({
      [LIST]: scrambleName("Offers to answer"),
      [SUB]: scrambleName("By Friday"),
      a: scrambleName("Call the lawyer"),
      b: scrambleName("Answer Nordea"),
    });
    expect([...useScrambledListsStore.getState().byList]).toEqual([[LIST, ME], [SUB, ME]]);
    expect([...useScrambledItemsStore.getState().byItem]).toEqual([["a", ME], ["b", ME]]);
    // Each remembers the list it was scrambled with; the list itself goes with nothing.
    expect([...useScrambledItemsStore.getState().withList]).toEqual([["a", LIST], ["b", LIST]]);
    expect([...useScrambledListsStore.getState().withList]).toEqual([[SUB, LIST]]);
    expect(toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: "List scrambled", description: expect.stringContaining("2 list names and 2 item names") }),
    );
  });

  it("changes only what the database says it scrambled", async () => {
    // Someone scrambled "b" a moment ago; the database passes it over.
    rpc.mockResolvedValue({ data: { lists: [LIST, SUB], items: ["a"] }, error: null });
    await useListScrambleStore.getState().scramble(LIST);
    expect(titles().b).toBe("Answer Nordea");
    expect(useScrambledItemsStore.getState().byItem.has("b")).toBe(false);
  });

  it("asks for a PIN to be chosen when the database wants one, and scrambles once it has it", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "Choose a PIN of four digits" } });
    await useListScrambleStore.getState().scramble(LIST);

    expect(useListScrambleStore.getState().prompt).toEqual({ backlogId: LIST, kind: "scramble", mode: "set" });
    expect(titles()[LIST]).toBe("Offers to answer");
    // Not an error to the person: it is the first step.
    expect(toast).not.toHaveBeenCalled();

    rpc.mockImplementation(scrambledAll);
    expect(await useListScrambleStore.getState().confirm("4917")).toEqual({});
    expect(rpc).toHaveBeenLastCalledWith("scramble_names", expect.objectContaining({ _pin: "4917" }));
    expect(titles()[LIST]).toBe(scrambleName("Offers to answer"));
  });

  it("says so when it cannot, and changes nothing", async () => {
    rpc.mockResolvedValue({ data: null, error: { message: "permission denied" } });
    await useListScrambleStore.getState().scramble(LIST);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Could not scramble", description: "permission denied" }));
    expect(useListScrambleStore.getState().prompt).toBeNull();
    expect(titles()[LIST]).toBe("Offers to answer");
  });

  it("sends a long list's items in runs, the lists with the first", async () => {
    const many = Object.fromEntries(
      Array.from({ length: SCRAMBLE_CHUNK + 5 }, (_, i) => [`w${i}`, workItem(`w${i}`, `Job ${i}`, LIST)]),
    );
    useAppStore.setState({ workItems: many });
    rpc.mockImplementation(scrambledAll);
    await useListScrambleStore.getState().scramble(LIST);

    expect(rpc).toHaveBeenCalledTimes(2);
    expect(rpc.mock.calls[0][1]._lists).toHaveLength(2);
    expect(rpc.mock.calls[0][1]._items).toHaveLength(SCRAMBLE_CHUNK);
    expect(rpc.mock.calls[1][1]._lists).toEqual([]);
    expect(rpc.mock.calls[1][1]._items).toHaveLength(5);
    expect(useScrambledItemsStore.getState().byItem.size).toBe(SCRAMBLE_CHUNK + 5);
  });

  it("a second time takes only what was added since", async () => {
    useScrambledListsStore.setState({ byList: new Map([[LIST, ME], [SUB, ME]]) });
    useScrambledItemsStore.setState({ byItem: new Map([["a", ME]]) });
    rpc.mockImplementation(scrambledAll);
    await useListScrambleStore.getState().scramble(LIST);

    expect(rpc).toHaveBeenCalledWith("scramble_names", {
      _lists: [],
      _items: [{ id: "b", title: scrambleName("Answer Nordea") }],
      _pin: null,
      _with_list: LIST,
    });
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Scrambled" }));
  });

  it("asks the database nothing when there is nothing to scramble", async () => {
    useScrambledListsStore.setState({ byList: new Map([[LIST, ME], [SUB, "someone"]]) });
    useScrambledItemsStore.setState({ byItem: new Map([["a", ME], ["b", "someone"]]) });
    await useListScrambleStore.getState().scramble(LIST);
    expect(rpc).not.toHaveBeenCalled();
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "Nothing new to scramble" }));
  });
});

describe("a scrambled list", () => {
  beforeEach(() => {
    useScrambledListsStore.setState({ byList: new Map([[LIST, ME], [SUB, "someone"]]) });
    useScrambledItemsStore.setState({ byItem: new Map([["a", ME], ["b", "someone"]]) });
    useAppStore.setState((s) => ({
      backlogs: { ...s.backlogs, [LIST]: { ...s.backlogs[LIST], name: "Moomin Snufkin" } },
      workItems: { ...s.workItems, a: { ...s.workItems.a, title: "Sniff Groke" } },
    }));
  });

  it("shows its real name against the PIN, and stays scrambled", async () => {
    useListScrambleStore.getState().askReveal(LIST);
    expect(useListScrambleStore.getState().prompt).toEqual({ backlogId: LIST, kind: "reveal", mode: "enter" });

    rpc.mockResolvedValue({ data: "Offers to answer", error: null });
    expect(await useListScrambleStore.getState().confirm("4917")).toEqual({ revealed: "Offers to answer" });
    expect(rpc).toHaveBeenCalledWith("reveal_scrambled_backlog_name", { _backlog_id: LIST, _pin: "4917" });
    expect(titles()[LIST]).toBe("Moomin Snufkin");
    expect(useScrambledListsStore.getState().byList.has(LIST)).toBe(true);
  });

  it("is unscrambled with everything of this person's in it — and nobody else's", async () => {
    useListScrambleStore.getState().askUnscramble(LIST);
    rpc.mockResolvedValue({
      data: { lists: [{ id: LIST, name: "Offers to answer" }], items: [{ id: "a", title: "Call the lawyer" }] },
      error: null,
    });
    expect(await useListScrambleStore.getState().confirm("4917")).toEqual({});

    expect(rpc).toHaveBeenCalledWith("unscramble_names", { _list_ids: [LIST], _item_ids: ["a"], _pin: "4917" });
    expect(titles()[LIST]).toBe("Offers to answer");
    expect(titles().a).toBe("Call the lawyer");
    expect([...useScrambledListsStore.getState().byList]).toEqual([[SUB, "someone"]]);
    expect([...useScrambledItemsStore.getState().byItem]).toEqual([["b", "someone"]]);
    expect(toast).toHaveBeenCalledWith(expect.objectContaining({ title: "List restored" }));
  });

  it("brings back an item scrambled with it that has since been moved to another list", async () => {
    // "gone" was scrambled with the list, then carried off elsewhere.
    useAppStore.setState((s) => ({
      workItems: { ...s.workItems, gone: { ...workItem("gone", "Snorkmaiden", "org::bl-elsewhere") } },
    }));
    useScrambledItemsStore.setState({
      byItem: new Map([["a", ME], ["gone", ME]]),
      withList: new Map([["a", LIST], ["gone", LIST]]),
    });
    useListScrambleStore.getState().askUnscramble(LIST);
    rpc.mockResolvedValue({
      data: {
        lists: [{ id: LIST, name: "Offers to answer" }],
        items: [{ id: "a", title: "Call the lawyer" }, { id: "gone", title: "PN" }],
      },
      error: null,
    });
    expect(await useListScrambleStore.getState().confirm("4917")).toEqual({});

    expect(rpc).toHaveBeenCalledWith("unscramble_names", { _list_ids: [LIST], _item_ids: ["a", "gone"], _pin: "4917" });
    expect(titles().gone).toBe("PN");
    expect(useScrambledItemsStore.getState().byItem.size).toBe(0);
    expect(useScrambledItemsStore.getState().withList.size).toBe(0);
  });

  it("stays as it is on a wrong PIN, and the dialog is told", async () => {
    useListScrambleStore.getState().askUnscramble(LIST);
    rpc.mockResolvedValue({ data: null, error: { message: "Wrong PIN" } });
    expect(await useListScrambleStore.getState().confirm("0000")).toEqual({ error: "Wrong PIN" });
    expect(titles()[LIST]).toBe("Moomin Snufkin");
    expect(useScrambledListsStore.getState().byList.get(LIST)).toBe(ME);
  });

  it("cannot be unscrambled by someone who scrambled nothing in it", async () => {
    setCurrentUser({ id: "visitor", email: null, fullName: null, avatarUrl: null });
    useListScrambleStore.getState().askUnscramble(LIST);
    expect(await useListScrambleStore.getState().confirm("4917")).toEqual({ error: "Nothing here that you scrambled" });
    expect(rpc).not.toHaveBeenCalled();
  });

  it("cannot be renamed, and says why", () => {
    expect(refuseRenameOfScrambledList(LIST)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ title: "This list's name is scrambled", description: "Unscramble the list before renaming it." }),
    );
    expect(refuseRenameOfScrambledList(SUB)).toBe(true);
    expect(toast).toHaveBeenLastCalledWith(
      expect.objectContaining({ description: "Only the person who scrambled it can change it." }),
    );
  });

  it("leaves an ordinary list free to rename", () => {
    useScrambledListsStore.setState({ byList: new Map() });
    expect(refuseRenameOfScrambledList(LIST)).toBe(false);
    expect(toast).not.toHaveBeenCalled();
  });
});
