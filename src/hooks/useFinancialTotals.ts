import { useCallback, useMemo, useRef, useSyncExternalStore } from "react";
import type { Backlog, WorkItem } from "@/types/models";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, effectiveSum } from "@/store/financialsStore";
import { useDisplayCurrencyStore } from "@/store/displayCurrencyStore";
import { useRatesStore, convertCurrency } from "@/store/ratesStore";
import { itemFieldsChanged } from "@/lib/itemFieldsChanged";

interface FinancialTotals {
  savings: number;
  income: number;
  /** Display currency that the values are expressed in. */
  currency: string;
  /** True when at least one work item in scope has any financial entry. */
  hasData: boolean;
}

function rollup(
  workItemIds: Iterable<string>,
  byWorkItem: Record<string, ReturnType<typeof useFinancialsStore.getState>["byWorkItem"][string]>,
  displayCurrency: string,
  rates: Record<string, number>,
): FinancialTotals {
  let savings = 0;
  let income = 0;
  let hasData = false;
  for (const id of workItemIds) {
    const e = byWorkItem[id];
    if (!e) continue;
    // Use actuals for past months, plan for current/future.
    const s = effectiveSum(e.savingsByMonth, e.actualSavingsByMonth);
    const i = effectiveSum(e.incomeByMonth, e.actualIncomeByMonth);
    if (s === 0 && i === 0) continue;
    hasData = true;
    savings += convertCurrency(s, e.currency, displayCurrency, rates);
    income += convertCurrency(i, e.currency, displayCurrency, rates);
  }
  return { savings, income, currency: displayCurrency, hasData };
}

/**
 * Sum of financial entries for a work item and all its descendants.
 *
 * Every row of the list reads this. It used to subscribe to the whole map of
 * items, so a change to any item, a rename say, drew every row again. It now
 * answers the same object while the sums stay the same, and a row draws again
 * only when its own sums change.
 */
export function useWorkItemFinancialTotals(workItemId: string): FinancialTotals {
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const displayCurrency = useDisplayCurrencyStore((s) => s.displayCurrency);
  const rates = useRatesStore((s) => s.rates);
  const last = useRef<FinancialTotals | null>(null);
  const select = useCallback(
    (s: { workItems: Record<string, WorkItem> }) => {
      const ids: string[] = [];
      const collect = (id: string) => {
        ids.push(id);
        s.workItems[id]?.childrenIds.forEach(collect);
      };
      collect(workItemId);
      const next = rollup(ids, byWorkItem, displayCurrency, rates);
      if (last.current && sameTotals(last.current, next)) return last.current;
      last.current = next;
      return next;
    },
    [workItemId, byWorkItem, displayCurrency, rates],
  );
  return useAppStore(select);
}

/**
 * Every backlog's and tree's totals, worked out once per change and shared by
 * the tree panel's rows — as lib/timeTotals does for logged time.
 *
 * Each row used to collect its own backlog's items over every item there is,
 * subscribed to the whole map of items: after any change, every row redrew and
 * made its own pass. With 52 lists and 5 000 items that held up every move
 * out of a long list. A row now reads its own totals, which keep their
 * identity while the values stay the same, so it redraws only when they change.
 *
 * The sums are the ones the rows made: each backlog's and tree's items, in the
 * order the store holds them, through rollup.
 */
type FinancialsKey = [
  Record<string, WorkItem>,
  Record<string, Backlog>,
  ReturnType<typeof useFinancialsStore.getState>["byWorkItem"],
  string,
  Record<string, number>,
];
let lastKey: FinancialsKey | null = null;
let backlogTotals = new Map<string, FinancialTotals>();
let treeTotals = new Map<string, FinancialTotals>();

const sameTotals = (a: FinancialTotals, b: FinancialTotals) =>
  a.savings === b.savings && a.income === b.income && a.currency === b.currency && a.hasData === b.hasData;

/** Keep the objects rows already have wherever the values are unchanged. */
function keepUnchanged(next: Map<string, FinancialTotals>, before: Map<string, FinancialTotals>) {
  for (const [id, totals] of next) {
    const old = before.get(id);
    if (old && sameTotals(old, totals)) next.set(id, old);
  }
  return next;
}

function ensureFinancials() {
  const { workItems, backlogs } = useAppStore.getState();
  const key: FinancialsKey = [
    workItems,
    backlogs,
    useFinancialsStore.getState().byWorkItem,
    useDisplayCurrencyStore.getState().displayCurrency,
    useRatesStore.getState().rates,
  ];
  if (lastKey && key.every((part, i) => (i === 0 ? !itemFieldsChanged(lastKey![0], workItems, ["backlogAssignments"]) : part === lastKey![i]))) {
    // All the sums read of the items is which there are and where each is.
    lastKey = key;
    return;
  }
  const [, , byWorkItem, displayCurrency, rates] = key;

  // The backlogs whose subtree holds each backlog, down childrenIds.
  const parentsOf = new Map<string, string[]>();
  for (const b of Object.values(backlogs)) {
    for (const c of b.childrenIds) {
      const list = parentsOf.get(c);
      if (list) list.push(b.id);
      else parentsOf.set(c, [b.id]);
    }
  }
  const above = new Map<string, string[]>();
  const aboveOf = (id: string) => {
    const known = above.get(id);
    if (known) return known;
    const ids = new Set<string>();
    const walk = (x: string) => {
      if (ids.has(x)) return;
      ids.add(x);
      parentsOf.get(x)?.forEach(walk);
    };
    walk(id);
    const list = [...ids];
    above.set(id, list);
    return list;
  };

  // Each backlog's and tree's items, in store order.
  const backlogItems = new Map<string, string[]>();
  const treeItems = new Map<string, string[]>();
  const add = (map: Map<string, string[]>, key: string, id: string) => {
    const list = map.get(key);
    if (list) list.push(id);
    else map.set(key, [id]);
  };
  for (const wi of Object.values(workItems)) {
    for (const [treeId, at] of Object.entries(wi.backlogAssignments)) {
      add(treeItems, treeId, wi.id);
      if (!at) continue;
      // Counted by a backlog only through its own tree's assignment.
      for (const b of aboveOf(at)) if (backlogs[b]?.treeId === treeId) add(backlogItems, b, wi.id);
    }
  }
  const empty: string[] = [];
  backlogTotals = keepUnchanged(
    new Map(Object.keys(backlogs).map((id) => [id, rollup(backlogItems.get(id) ?? empty, byWorkItem, displayCurrency, rates)])),
    backlogTotals,
  );
  treeTotals = keepUnchanged(
    new Map([...treeItems].map(([treeId, ids]) => [treeId, rollup(ids, byWorkItem, displayCurrency, rates)])),
    treeTotals,
  );
  lastKey = key;
}

function subscribeFinancials(onChange: () => void): () => void {
  const unsubscribe = [
    useAppStore.subscribe(onChange),
    useFinancialsStore.subscribe(onChange),
    useDisplayCurrencyStore.subscribe(onChange),
    useRatesStore.subscribe(onChange),
  ];
  return () => unsubscribe.forEach((u) => u());
}

/** Nothing in scope, in the display currency — one object per currency, so it stays the same. */
const noneIn = new Map<string, FinancialTotals>();
function none(): FinancialTotals {
  const currency = useDisplayCurrencyStore.getState().displayCurrency;
  let totals = noneIn.get(currency);
  if (!totals) noneIn.set(currency, (totals = { savings: 0, income: 0, currency, hasData: false }));
  return totals;
}

/** Sum of financial entries for a backlog (including descendant backlogs), in its own tree. */
export function useBacklogFinancialTotals(backlogId: string): FinancialTotals {
  const getSnapshot = useCallback(() => {
    ensureFinancials();
    return backlogTotals.get(backlogId) ?? none();
  }, [backlogId]);
  return useSyncExternalStore(subscribeFinancials, getSnapshot, getSnapshot);
}

/** Sum of financial entries for every work item assigned to a tree. */
export function useTreeFinancialTotals(treeId: string): FinancialTotals {
  const getSnapshot = useCallback(() => {
    ensureFinancials();
    return treeTotals.get(treeId) ?? none();
  }, [treeId]);
  return useSyncExternalStore(subscribeFinancials, getSnapshot, getSnapshot);
}
