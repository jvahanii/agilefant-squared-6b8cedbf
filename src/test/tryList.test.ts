/**
 * What a visitor adds in the try-out (2026-11-16): how it is kept in the
 * browser, what it becomes when brought into a new account, and how long it
 * is kept.
 */
import { describe, it, expect, beforeEach } from "vitest";
import {
  countNodes,
  loadTryList,
  sanitize,
  saveTryList,
  statusOf,
  takeTriedList,
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
    A2a x
B
C`);

describe("statuses", () => {
  it("a parent is in progress while part of it is done", () => {
    expect(statusOf(LIST, 3)).toBe("done");
    expect(statusOf(LIST, 2)).toBe("in_progress");
    expect(statusOf(LIST, 0)).toBe("in_progress");
    expect(statusOf(LIST, 4)).toBe("not_started");
  });

  it("the outline becomes nested items with those statuses", () => {
    expect(toTree(LIST)).toEqual([
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
