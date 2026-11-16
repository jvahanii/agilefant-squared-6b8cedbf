/**
 * The try-out list on /try (2026-11-16): the outline operations, what becomes
 * of it when it is brought into a new account, and how long it is kept.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  addTitles,
  countNodes,
  exampleItems,
  indent,
  loadTryList,
  MAX_TRY_ITEMS,
  outdent,
  remove,
  sanitize,
  saveTryList,
  statusOf,
  takeTriedList,
  toggleDone,
  toTree,
  TRY_LIST_DAYS,
  TRY_LIST_KEY,
  type TryItem,
} from "@/lib/tryList";

const outline = (spec: string): TryItem[] =>
  spec
    .trim()
    .split("\n")
    .map((line, i) => {
      const depth = (line.length - line.trimStart().length) / 2;
      const text = line.trim();
      const done = text.endsWith(" x");
      return { id: `i${i}`, title: done ? text.slice(0, -2) : text, depth, done };
    });
const show = (items: TryItem[]) => items.map((it) => `${"  ".repeat(it.depth)}${it.title}${it.done ? " x" : ""}`).join("\n");

const LIST = outline(`
A
  A1
  A2
    A2a
B
C`);

describe("nesting", () => {
  it("Tab puts an item, with its sub-items, under the item above", () => {
    expect(show(indent(LIST, 4))).toBe(show(outline(`
A
  A1
  A2
    A2a
  B
C`)));
    expect(show(indent(LIST, 2))).toBe(show(outline(`
A
  A1
    A2
      A2a
B
C`)));
  });

  it("Tab does nothing for the first item, or one already a step below the item above", () => {
    expect(indent(LIST, 0)).toBe(LIST);
    expect(indent(LIST, 1)).toBe(LIST);
    expect(indent(LIST, 3)).toBe(LIST);
  });

  it("Shift+Tab brings an item and its sub-items out one level, and does nothing at the top", () => {
    expect(show(outdent(LIST, 2))).toBe(show(outline(`
A
  A1
A2
  A2a
B
C`)));
    expect(outdent(LIST, 0)).toBe(LIST);
  });

  it("deleting an item deletes what is under it", () => {
    expect(show(remove(LIST, 0))).toBe("B\nC");
    expect(show(remove(LIST, 5))).toBe(show(LIST.slice(0, 5)));
  });
});

describe("statuses", () => {
  it("a parent is in progress while part of it is done", () => {
    const items = toggleDone(LIST, 3);
    expect(statusOf(items, 3)).toBe("done");
    expect(statusOf(items, 2)).toBe("in_progress");
    expect(statusOf(items, 0)).toBe("in_progress");
    expect(statusOf(items, 4)).toBe("not_started");
    expect(statusOf(toggleDone(items, 0), 0)).toBe("done");
  });

  it("the outline becomes nested items with those statuses", () => {
    expect(toTree(toggleDone(LIST, 3))).toEqual([
      {
        title: "A",
        status: "in_progress",
        children: [
          { title: "A1", status: "not_started" },
          { title: "A2", status: "in_progress", children: [{ title: "A2a", status: "done" }] },
        ],
      },
      { title: "B", status: "not_started" },
      { title: "C", status: "not_started" },
    ]);
    expect(countNodes(toTree(LIST))).toBe(6);
  });
});

describe("adding", () => {
  it("adds at the end, at the top level, up to the limit", () => {
    expect(show(addTitles(LIST, ["D", "E"]).slice(-3))).toBe("C\nD\nE");
    const full = addTitles([], Array.from({ length: MAX_TRY_ITEMS + 5 }, (_, i) => `t${i}`));
    expect(full).toHaveLength(MAX_TRY_ITEMS);
    expect(addTitles(full, ["more"])).toHaveLength(MAX_TRY_ITEMS);
  });

  it("the examples show nesting and a done item", () => {
    const ex = exampleItems();
    expect(ex.some((it) => it.depth > 0)).toBe(true);
    expect(ex.some((it) => it.done)).toBe(true);
    expect(sanitize(ex)).toHaveLength(ex.length);
  });
});

describe("what is stored", () => {
  beforeEach(() => localStorage.clear());

  it("is made well-formed whatever it holds", () => {
    expect(sanitize(null)).toBeNull();
    expect(sanitize("x")).toBeNull();
    expect(sanitize([{ title: "  " }, 3, null])).toBeNull();
    const fixed = sanitize([
      { title: " First ", depth: 2, done: "yes" },
      { title: "Second", depth: 5, done: true },
      { title: "Third", depth: -1 },
      { title: "x".repeat(900), depth: 1.5 },
    ])!;
    expect(fixed.map((it) => [it.title.length > 100 ? "long" : it.title, it.depth, it.done])).toEqual([
      ["First", 0, false],
      ["Second", 1, true],
      ["Third", 0, false],
      ["long", 0, false],
    ]);
    expect(fixed[3].title).toHaveLength(500);
  });

  it("keeps the titles, depths and done marks, and nothing else", () => {
    saveTryList(LIST);
    const raw = JSON.parse(localStorage.getItem(TRY_LIST_KEY)!);
    expect(Object.keys(raw).sort()).toEqual(["items", "savedAt"]);
    expect(Object.keys(raw.items[0]).sort()).toEqual(["depth", "done", "title"]);
    expect(show(loadTryList()!)).toBe(show(LIST));
  });

  it("an empty list is forgotten", () => {
    saveTryList(LIST);
    saveTryList([]);
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
  });

  it("is taken out once, as nested items", () => {
    saveTryList(LIST);
    expect(countNodes(takeTriedList()!)).toBe(6);
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
    expect(takeTriedList()).toBeNull();
  });

  it(`is dropped after ${TRY_LIST_DAYS} days, or with a date in the future`, () => {
    const saved = new Date("2026-11-16T12:00:00Z");
    const day = 86_400_000;
    saveTryList(LIST, saved);
    expect(loadTryList(new Date(saved.getTime() + TRY_LIST_DAYS * day - 1))).not.toBeNull();
    expect(takeTriedList(new Date(saved.getTime() + TRY_LIST_DAYS * day + 1))).toBeNull();
    expect(localStorage.getItem(TRY_LIST_KEY)).toBeNull();
    saveTryList(LIST, saved);
    expect(loadTryList(new Date(saved.getTime() - day))).toBeNull();
  });

  it("garbage in storage is ignored", () => {
    localStorage.setItem(TRY_LIST_KEY, "{not json");
    expect(loadTryList()).toBeNull();
    expect(takeTriedList()).toBeNull();
  });
});
