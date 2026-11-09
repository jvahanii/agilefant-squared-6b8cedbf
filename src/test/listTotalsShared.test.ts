/**
 * The tree panel's totals — each list's points, and each list's and tree's
 * savings and income — worked out once per change and shared by the rows
 * (lib/backlogPointsCache, hooks/useFinancialTotals), instead of each row
 * making its own pass over every item.
 *
 * What matters: every number is the one the row used to work out for itself,
 * and a row redraws only when its own numbers change. Checked on two hundred
 * made-up organizations each — nested lists, items whose parents sit in other
 * lists and other trees, parents that differ per tree, estimates on lists —
 * against the per-list code the rows used to run.
 */
import { describe, it, expect, beforeEach } from "vitest";
import { act, renderHook } from "@testing-library/react";
import { allBacklogPoints, backlogPoints } from "@/lib/backlogPoints";
import { useBacklogPointsCached } from "@/lib/backlogPointsCache";
import { useBacklogFinancialTotals, useTreeFinancialTotals } from "@/hooks/useFinancialTotals";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, effectiveSum, type WorkItemFinancials } from "@/store/financialsStore";
import { useDisplayCurrencyStore } from "@/store/displayCurrencyStore";
import { useRatesStore, convertCurrency } from "@/store/ratesStore";
import type { Backlog, BacklogTree, WorkItem } from "@/types/models";

/** A small seeded generator, so a failure can be run again. */
function random(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

interface World {
  items: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  trees: Record<string, BacklogTree>;
  financials: Record<string, WorkItemFinancials>;
}

/** A made-up organization: two trees of nested lists, items across them. */
function world(seed: number): World {
  const r = random(seed);
  const pick = <X>(xs: X[]) => xs[Math.floor(r() * xs.length)];
  const trees: Record<string, BacklogTree> = {};
  const backlogs: Record<string, Backlog> = {};
  for (const t of ["t1", "t2"]) {
    trees[t] = { id: t, name: t, rootBacklogIds: [], rank: 0 } as BacklogTree;
    const inTree: string[] = [];
    const count = 2 + Math.floor(r() * 5);
    for (let i = 0; i < count; i++) {
      const id = `${t}-b${i}`;
      const parent = inTree.length > 0 && r() < 0.6 ? pick(inTree) : null;
      backlogs[id] = {
        id, name: id, parentId: parent, childrenIds: [], treeId: t, rank: i,
        ...(r() < 0.25 ? { points: Math.floor(r() * 40) } : {}),
      } as Backlog;
      if (parent) backlogs[parent].childrenIds.push(id);
      else trees[t].rootBacklogIds.push(id);
      inTree.push(id);
    }
  }
  const listsOf = (t: string) => Object.values(backlogs).filter((b) => b.treeId === t).map((b) => b.id);
  const items: Record<string, WorkItem> = {};
  const ids: string[] = [];
  const count = 10 + Math.floor(r() * 40);
  for (let i = 0; i < count; i++) {
    const id = `w${i}`;
    const backlogAssignments: Record<string, string> = { t1: pick(listsOf("t1")) };
    if (r() < 0.3) backlogAssignments.t2 = pick(listsOf("t2"));
    // Now and then a stale one, naming a list of the other tree — left by a
    // list moved between trees. A list counts an item only through its own
    // tree's assignment.
    else if (r() < 0.1) backlogAssignments.t2 = pick(listsOf("t1"));
    // Parents only among earlier items: real data has no cycles.
    const parentId = ids.length > 0 && r() < 0.5 ? pick(ids) : null;
    const parentIds = ids.length > 0 && r() < 0.15 ? { t1: r() < 0.3 ? null : pick(ids) } : undefined;
    items[id] = {
      id, title: id, status: "not_started", parentId, ...(parentIds ? { parentIds } : {}),
      childrenIds: [], backlogAssignments, ranks: {},
      ...(r() < 0.6 ? { points: Math.floor(r() * 13) } : {}),
    } as WorkItem;
    // As the store has it: a child is listed under its default parent and under
    // any parent a tree gives it.
    for (const p of new Set([parentId, ...Object.values(parentIds ?? {})])) if (p) items[p].childrenIds.push(id);
    ids.push(id);
  }
  const financials: Record<string, WorkItemFinancials> = {};
  for (const id of ids) {
    if (r() > 0.4) continue;
    const amount = () => Math.round(r() * 100000) / 100;
    financials[id] = {
      id: `f-${id}`, workItemId: id, organizationId: "org",
      savingsByMonth: { "2025-01": amount(), "2031-06": amount() }, incomeByMonth: { "2025-02": amount() },
      actualSavingsByMonth: { "2025-01": amount() }, actualIncomeByMonth: {},
      currency: r() < 0.5 ? "EUR" : "USD", createdAt: "", updatedAt: "",
    };
  }
  return { items, backlogs, trees, financials };
}

const RATES = { EUR: 1, USD: 1.1, SEK: 11.5 };

/** What a row used to work out for its list, item by item in store order. */
function rolledUp(ids: string[], w: World, currency: string) {
  let savings = 0;
  let income = 0;
  let hasData = false;
  for (const id of ids) {
    const e = w.financials[id];
    if (!e) continue;
    const s = effectiveSum(e.savingsByMonth, e.actualSavingsByMonth);
    const i = effectiveSum(e.incomeByMonth, e.actualIncomeByMonth);
    if (s === 0 && i === 0) continue;
    hasData = true;
    savings += convertCurrency(s, e.currency, currency, RATES);
    income += convertCurrency(i, e.currency, currency, RATES);
  }
  return { savings, income, currency, hasData };
}
function listFinancialsBefore(w: World, backlogId: string, currency: string) {
  const treeId = w.backlogs[backlogId].treeId;
  const under = new Set<string>();
  const walk = (id: string) => {
    under.add(id);
    w.backlogs[id]?.childrenIds.forEach(walk);
  };
  walk(backlogId);
  const ids = Object.values(w.items).filter((wi) => wi.backlogAssignments[treeId] && under.has(wi.backlogAssignments[treeId])).map((wi) => wi.id);
  return rolledUp(ids, w, currency);
}
function treeFinancialsBefore(w: World, treeId: string, currency: string) {
  return rolledUp(Object.values(w.items).filter((wi) => treeId in wi.backlogAssignments).map((wi) => wi.id), w, currency);
}

function load(w: World) {
  useAppStore.setState({ workItems: w.items, backlogs: w.backlogs, backlogTrees: w.trees } as never);
  useFinancialsStore.setState({ byWorkItem: w.financials } as never);
  useRatesStore.setState({ rates: RATES } as never);
  useDisplayCurrencyStore.setState({ displayCurrency: "EUR" } as never);
}

beforeEach(() => load({ items: {}, backlogs: {}, trees: {}, financials: {} }));

describe("every list's points at once", () => {
  it("are each list's points as backlogPoints gives them, in two hundred made-up organizations", () => {
    let withPoints = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = world(seed);
      const all = allBacklogPoints(w.items, w.backlogs);
      for (const b of Object.values(w.backlogs)) {
        const before = backlogPoints(b.id, b.treeId, w.items, w.backlogs);
        expect(all.get(b.id), `seed ${seed}, ${b.id}`).toEqual(before);
        if (before.effective > 0) withPoints++;
      }
    }
    // The comparison is about something: most lists have points to add up.
    expect(withPoints).toBeGreaterThan(500);
  });
});

describe("a list row's points", () => {
  it("are the list's own, and the same object until they change", () => {
    const w = world(7);
    load(w);
    const id = Object.keys(w.backlogs)[0];
    const { result } = renderHook(() => useBacklogPointsCached(id));
    expect(result.current).toEqual(backlogPoints(id, w.backlogs[id].treeId, w.items, w.backlogs));
    const first = result.current;
    // A change that leaves this list's points as they are: the same object, so no redraw.
    act(() => useAppStore.setState({ workItems: { ...w.items } } as never));
    expect(result.current).toBe(first);
  });

  it("redraw only the row whose points changed", () => {
    const w = world(11);
    load(w);
    const [a, b] = ["t1", "t2"].map((t) => w.trees[t].rootBacklogIds[0]);
    const renders = { a: 0, b: 0 };
    renderHook(() => (renders.a++, useBacklogPointsCached(a)));
    const rowB = renderHook(() => (renders.b++, useBacklogPointsCached(b)));
    const before = { ...renders };
    // An item of list a, estimated higher; it is in no list of tree two.
    const itemOfA = Object.values(w.items).find((wi) => wi.backlogAssignments.t1 === a && !wi.backlogAssignments.t2 && !wi.parentId);
    const item: WorkItem = itemOfA ?? { id: "new", title: "new", status: "not_started", parentId: null, childrenIds: [], backlogAssignments: { t1: a }, ranks: {} } as WorkItem;
    act(() => useAppStore.setState({ workItems: { ...w.items, [item.id]: { ...item, points: (item.points ?? 0) + 100 } } } as never));
    expect(renders.a).toBeGreaterThan(before.a);
    expect(renders.b).toBe(before.b);
    expect(rowB.result.current).toEqual(backlogPoints(b, "t2", useAppStore.getState().workItems, w.backlogs));
  });
});

describe("a list's and a tree's savings and income", () => {
  it("are what each row used to add up, in two hundred made-up organizations", () => {
    let withData = 0;
    for (let seed = 1; seed <= 200; seed++) {
      const w = world(seed);
      load(w);
      for (const b of Object.values(w.backlogs)) {
        const { result, unmount } = renderHook(() => useBacklogFinancialTotals(b.id));
        expect(result.current, `seed ${seed}, ${b.id}`).toEqual(listFinancialsBefore(w, b.id, "EUR"));
        if (result.current.hasData) withData++;
        unmount();
      }
      for (const t of Object.keys(w.trees)) {
        const { result, unmount } = renderHook(() => useTreeFinancialTotals(t));
        expect(result.current, `seed ${seed}, ${t}`).toEqual(treeFinancialsBefore(w, t, "EUR"));
        unmount();
      }
    }
    expect(withData).toBeGreaterThan(500);
  });

  it("follow the display currency, the rates and the entries", () => {
    const w = world(3);
    load(w);
    const id = w.trees.t1.rootBacklogIds[0];
    const list = renderHook(() => useBacklogFinancialTotals(id));
    const tree = renderHook(() => useTreeFinancialTotals("t1"));
    act(() => useDisplayCurrencyStore.setState({ displayCurrency: "SEK" } as never));
    expect(list.result.current).toEqual(listFinancialsBefore(w, id, "SEK"));
    expect(tree.result.current).toEqual(treeFinancialsBefore(w, "t1", "SEK"));
    const someItem = Object.values(w.items).find((wi) => wi.backlogAssignments.t1 === id)!;
    const changed = {
      ...w.financials,
      [someItem.id]: { id: "f", workItemId: someItem.id, organizationId: "org", savingsByMonth: { "2031-01": 500 }, incomeByMonth: {}, actualSavingsByMonth: {}, actualIncomeByMonth: {}, currency: "EUR", createdAt: "", updatedAt: "" },
    };
    act(() => useFinancialsStore.setState({ byWorkItem: changed } as never));
    expect(list.result.current).toEqual(listFinancialsBefore({ ...w, financials: changed }, id, "SEK"));
  });

  it("keep the same object for a row whose totals did not change", () => {
    const w = world(5);
    load(w);
    const id = w.trees.t2.rootBacklogIds[0];
    const { result } = renderHook(() => useBacklogFinancialTotals(id));
    const first = result.current;
    act(() => useAppStore.setState({ workItems: { ...w.items } } as never));
    expect(result.current).toBe(first);
  });
});
