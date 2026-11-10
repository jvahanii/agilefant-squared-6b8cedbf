/**
 * The totals shared by the panels — each list's points, logged time per item,
 * list and tree, and each list's and tree's savings and income — are not worked
 * out again after a change that cannot affect them: a rename, a status, a
 * rating. With 5 000 items that took tens of milliseconds of every edit.
 *
 * What matters is that skipping never leaves a stale number. In thirty made-up
 * organizations, each total is checked against a fresh calculation after every
 * edit of a long random run of every kind: the ones that cannot change a total
 * and the ones that can, made the way the store makes them, as new objects.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { act, render } from "@testing-library/react";

vi.mock("@/lib/backlogPoints", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/backlogPoints")>();
  return { ...actual, allBacklogPoints: vi.fn(actual.allBacklogPoints) };
});
vi.mock("@/lib/timeTotalsCore", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/timeTotalsCore")>();
  return { ...actual, computeTimeTotals: vi.fn(actual.computeTimeTotals) };
});

import { allBacklogPoints, backlogPoints } from "@/lib/backlogPoints";
import { computeTimeTotals } from "@/lib/timeTotalsCore";
import { useBacklogPointsCached } from "@/lib/backlogPointsCache";
import { useWorkItemTotalMinutes, useBacklogTotalMinutesCached, useTreeTotalMinutesCached } from "@/lib/timeTotals";
import { useBacklogFinancialTotals, useTreeFinancialTotals, useWorkItemFinancialTotals } from "@/hooks/useFinancialTotals";
import { useAppStore } from "@/store/appStore";
import { useTimeEntryStore, type TimeEntry } from "@/store/timeEntryStore";
import { useFinancialsStore, effectiveSum, type WorkItemFinancials } from "@/store/financialsStore";
import { useDisplayCurrencyStore } from "@/store/displayCurrencyStore";
import { useRatesStore } from "@/store/ratesStore";
import type { Backlog, BacklogTree, WorkItem } from "@/types/models";

function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const TREES = ["t1", "t2"];

/** A made-up organization: two trees of nested lists, items across them, time and money on some. */
function world(seed: number) {
  const r = random(seed);
  const pick = <X,>(xs: X[]) => xs[Math.floor(r() * xs.length)];
  const trees: Record<string, BacklogTree> = {};
  const backlogs: Record<string, Backlog> = {};
  for (const t of TREES) {
    trees[t] = { id: t, name: t, rootBacklogIds: [], rank: 0 } as BacklogTree;
    const inTree: string[] = [];
    for (let i = 0; i < 2 + Math.floor(r() * 4); i++) {
      const id = `${t}-b${i}`;
      const parent = inTree.length > 0 && r() < 0.6 ? pick(inTree) : null;
      backlogs[id] = { id, name: id, parentId: parent, childrenIds: [], treeId: t, rank: i, ...(r() < 0.2 ? { points: 20 } : {}) } as Backlog;
      if (parent) backlogs[parent].childrenIds.push(id);
      else trees[t].rootBacklogIds.push(id);
      inTree.push(id);
    }
  }
  const items: Record<string, WorkItem> = {};
  const ids: string[] = [];
  for (let i = 0; i < 12 + Math.floor(r() * 25); i++) {
    const id = `w${i}`;
    const backlogAssignments: Record<string, string> = { t1: pick(Object.keys(backlogs).filter((b) => b.startsWith("t1"))) };
    if (r() < 0.3) backlogAssignments.t2 = pick(Object.keys(backlogs).filter((b) => b.startsWith("t2")));
    const parentId = ids.length > 0 && r() < 0.5 ? pick(ids) : null;
    items[id] = {
      id, title: id, status: "not_started", parentId, childrenIds: [], backlogAssignments, ranks: {},
      ...(r() < 0.6 ? { points: Math.floor(r() * 13) } : {}),
    } as WorkItem;
    if (parentId) items[parentId].childrenIds.push(id);
    ids.push(id);
  }
  const entries: Record<string, TimeEntry> = {};
  ids.forEach((id, i) => {
    if (r() < 0.4) entries[`e${i}`] = { id: `e${i}`, organizationId: "o", userId: "u", workItemId: id, backlogId: null, treeId: null, durationMinutes: 15 + i, spentDate: "2026-01-01", note: null, createdAt: "" };
  });
  const financials: Record<string, WorkItemFinancials> = {};
  ids.forEach((id) => {
    if (r() < 0.3) financials[id] = { id: `f-${id}`, workItemId: id, organizationId: "o", savingsByMonth: { "2031-01": 100 }, incomeByMonth: { "2031-02": 50 }, actualSavingsByMonth: {}, actualIncomeByMonth: {}, currency: "EUR", createdAt: "", updatedAt: "" };
  });
  return { r, pick, items, backlogs, trees, entries, financials };
}

type World = ReturnType<typeof world>;

/** One edit, made as the store makes it: the item replaced by a new object, and its relatives where they change too. */
function edit(w: World, items: Record<string, WorkItem>): { kind: string; items: Record<string, WorkItem> } {
  const { r, pick } = w;
  const ids = Object.keys(items);
  const id = pick(ids);
  const it = items[id];
  const next = { ...items };
  const kind = pick(["rename", "status", "rating", "deadline", "rebuilt", "points", "move", "reparent", "treeParent", "add", "delete"]);
  switch (kind) {
    case "rename": next[id] = { ...it, title: `${it.title}!` }; break;
    case "status": next[id] = { ...it, status: it.status === "done" ? "not_started" : "done" }; break;
    case "rating": next[id] = { ...it, rating: 1 + Math.floor(r() * 5) }; break;
    case "deadline": next[id] = { ...it, deadline: "2027-01-01" }; break;
    // The same contents in new objects, as a load or a live update makes them.
    case "rebuilt": next[id] = { ...it, childrenIds: [...it.childrenIds], backlogAssignments: { ...it.backlogAssignments } }; break;
    case "points": next[id] = { ...it, points: r() < 0.2 ? undefined : Math.floor(r() * 21) }; break;
    case "move": {
      const tree = pick(TREES);
      next[id] = { ...it, backlogAssignments: { ...it.backlogAssignments, [tree]: pick(Object.keys(w.backlogs).filter((b) => b.startsWith(tree))) } };
      break;
    }
    case "reparent": {
      // A new parent that is not the item itself or below it.
      const below = new Set<string>();
      const walk = (x: string) => { below.add(x); items[x]?.childrenIds.forEach(walk); };
      walk(id);
      const candidates = ids.filter((x) => !below.has(x));
      const parent = r() < 0.3 || candidates.length === 0 ? null : pick(candidates);
      if (it.parentId && next[it.parentId]) next[it.parentId] = { ...next[it.parentId], childrenIds: next[it.parentId].childrenIds.filter((c) => c !== id) };
      if (parent) next[parent] = { ...next[parent], childrenIds: [...next[parent].childrenIds, id] };
      next[id] = { ...it, parentId: parent };
      break;
    }
    case "treeParent": next[id] = { ...it, parentIds: { t1: null } }; break;
    case "add": {
      const nid = `n${ids.length}-${Math.floor(r() * 1e6)}`;
      next[nid] = { id: nid, title: nid, status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { t1: pick(Object.keys(w.backlogs).filter((b) => b.startsWith("t1"))) }, ranks: {}, points: 5 } as WorkItem;
      break;
    }
    case "delete": {
      if (it.childrenIds.length > 0) return { kind: "none", items };
      delete next[id];
      if (it.parentId && next[it.parentId]) next[it.parentId] = { ...next[it.parentId], childrenIds: next[it.parentId].childrenIds.filter((c) => c !== id) };
      break;
    }
  }
  return { kind, items: next };
}

/** What every total should be for these items, worked out afresh. */
function fresh(w: World, items: Record<string, WorkItem>) {
  const time = vi.mocked(computeTimeTotals).getMockImplementation()!(w.entries, items, w.backlogs);
  const money = (ids: string[]) => {
    let savings = 0, income = 0, hasData = false;
    for (const id of ids) {
      const e = w.financials[id];
      if (!e) continue;
      const s = effectiveSum(e.savingsByMonth, e.actualSavingsByMonth);
      const i = effectiveSum(e.incomeByMonth, e.actualIncomeByMonth);
      if (s === 0 && i === 0) continue;
      hasData = true; savings += s; income += i;
    }
    return { savings, income, currency: "EUR", hasData };
  };
  const listItems = (b: Backlog) => {
    const under = new Set<string>();
    const walk = (x: string) => { under.add(x); w.backlogs[x]?.childrenIds.forEach(walk); };
    walk(b.id);
    return Object.values(items).filter((wi) => under.has(wi.backlogAssignments[b.treeId])).map((wi) => wi.id);
  };
  const subtree = (id: string) => {
    const out: string[] = [];
    const walk = (x: string) => { out.push(x); items[x]?.childrenIds.forEach(walk); };
    walk(id);
    return out;
  };
  return {
    points: Object.values(w.backlogs).map((b) => backlogPoints(b.id, b.treeId, items, w.backlogs)),
    listTime: Object.values(w.backlogs).map((b) => time.bl.get(`${b.treeId}::${b.id}`) ?? 0),
    treeTime: TREES.map((t) => time.tree.get(t) ?? 0),
    itemTime: Object.keys(w.items).map((id) => time.wi.get(id) ?? 0),
    listMoney: Object.values(w.backlogs).map((b) => money(listItems(b))),
    treeMoney: TREES.map((t) => money(Object.values(items).filter((wi) => t in wi.backlogAssignments).map((wi) => wi.id))),
    itemMoney: Object.keys(w.items).map((id) => money(subtree(id))),
  };
}

/** One total, read as a row reads it: one hook, in a component of its own. */
function Total({ read, args, into, at }: { read: (...args: never[]) => unknown; args: unknown[]; into: unknown[]; at: number }) {
  into[at] = (read as (...args: unknown[]) => unknown)(...args);
  return null;
}

/** Every total, each read by a component of its own as the panels' rows read them; `current` holds what each read last. */
function mountAllTotals(w: World) {
  const lists = Object.values(w.backlogs);
  const itemIds = Object.keys(w.items);
  const reads: Record<string, [(...args: never[]) => unknown, unknown[][]]> = {
    points: [useBacklogPointsCached, lists.map((b) => [b.id])],
    listTime: [useBacklogTotalMinutesCached, lists.map((b) => [b.id, b.treeId])],
    treeTime: [useTreeTotalMinutesCached, TREES.map((t) => [t])],
    itemTime: [useWorkItemTotalMinutes, itemIds.map((id) => [id])],
    listMoney: [useBacklogFinancialTotals, lists.map((b) => [b.id])],
    treeMoney: [useTreeFinancialTotals, TREES.map((t) => [t])],
    itemMoney: [useWorkItemFinancialTotals, itemIds.map((id) => [id])],
  };
  const current: Record<string, unknown[]> = Object.fromEntries(Object.keys(reads).map((k) => [k, []]));
  const { unmount } = render(
    <>
      {Object.entries(reads).flatMap(([kind, [read, argsList]]) =>
        argsList.map((args, i) => <Total key={`${kind}-${i}`} read={read} args={args} into={current[kind]} at={i} />),
      )}
    </>,
  );
  return { current, unmount };
}

function load(w: World) {
  useAppStore.setState({ workItems: w.items, backlogs: w.backlogs, backlogTrees: w.trees } as never);
  useTimeEntryStore.setState({ timeEntries: w.entries } as never);
  useFinancialsStore.setState({ byWorkItem: w.financials } as never);
  useRatesStore.setState({ rates: { EUR: 1 } } as never);
  useDisplayCurrencyStore.setState({ displayCurrency: "EUR" } as never);
}

beforeEach(() => {
  vi.mocked(allBacklogPoints).mockClear();
  vi.mocked(computeTimeTotals).mockClear();
});

describe("the shared totals, with work skipped where a change cannot affect them", () => {
  it("are what a fresh calculation gives after every edit, in thirty made-up organizations", () => {
    const kinds = new Map<string, number>();
    for (let seed = 1; seed <= 30; seed++) {
      const w = world(seed);
      load(w);
      const { current, unmount } = mountAllTotals(w);
      expect(current, `seed ${seed}, at the start`).toEqual(fresh(w, w.items));
      let items = w.items;
      for (let step = 0; step < 30; step++) {
        const made = edit(w, items);
        items = made.items;
        kinds.set(made.kind, (kinds.get(made.kind) ?? 0) + 1);
        act(() => useAppStore.setState({ workItems: items } as never));
        expect(current, `seed ${seed}, step ${step}: ${made.kind}`).toEqual(fresh(w, items));
      }
      unmount();
    }
    // Every kind of edit was made, many times over.
    for (const kind of ["rename", "status", "rating", "deadline", "rebuilt", "points", "move", "reparent", "treeParent", "add", "delete"]) {
      expect(kinds.get(kind) ?? 0, kind).toBeGreaterThan(30);
    }
  }, 60_000);

  it("are not worked out again after a rename, a status, a rating or a deadline", () => {
    const w = world(4);
    load(w);
    mountAllTotals(w);
    const counts = () => [vi.mocked(allBacklogPoints).mock.calls.length, vi.mocked(computeTimeTotals).mock.calls.length];
    const start = counts();
    const id = Object.keys(w.items)[3];
    for (const over of [{ title: "Renamed" }, { status: "done" as const }, { rating: 3 }, { deadline: "2027-02-02" }]) {
      act(() => useAppStore.setState((s) => ({ workItems: { ...s.workItems, [id]: { ...s.workItems[id], ...over } } }) as never));
    }
    expect(counts()).toEqual(start);
    // Points are: the points totals, but not the time.
    act(() => useAppStore.setState((s) => ({ workItems: { ...s.workItems, [id]: { ...s.workItems[id], points: 99 } } }) as never));
    expect(counts()).toEqual([start[0] + 1, start[1]]);
    // A move is, both.
    act(() => useAppStore.setState((s) => ({ workItems: { ...s.workItems, [id]: { ...s.workItems[id], backlogAssignments: { t1: "t1-b1" } } } }) as never));
    expect(counts()).toEqual([start[0] + 2, start[1] + 1]);
  });
});
