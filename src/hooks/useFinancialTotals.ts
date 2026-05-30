import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, sumMap } from "@/store/financialsStore";
import { useDisplayCurrencyStore } from "@/store/displayCurrencyStore";
import { useRatesStore, convertCurrency } from "@/store/ratesStore";

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
    const s = sumMap(e.savingsByMonth);
    const i = sumMap(e.incomeByMonth);
    if (s === 0 && i === 0) continue;
    hasData = true;
    savings += convertCurrency(s, e.currency, displayCurrency, rates);
    income += convertCurrency(i, e.currency, displayCurrency, rates);
  }
  return { savings, income, currency: displayCurrency, hasData };
}

/** Sum of financial entries for a work item and all its descendants. */
export function useWorkItemFinancialTotals(workItemId: string): FinancialTotals {
  const workItems = useAppStore((s) => s.workItems);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const displayCurrency = useDisplayCurrencyStore((s) => s.displayCurrency);
  const rates = useRatesStore((s) => s.rates);
  return useMemo(() => {
    const ids: string[] = [];
    const collect = (id: string) => {
      ids.push(id);
      workItems[id]?.childrenIds.forEach(collect);
    };
    collect(workItemId);
    return rollup(ids, byWorkItem, displayCurrency, rates);
  }, [workItemId, workItems, byWorkItem, displayCurrency, rates]);
}

/** Sum of financial entries for a backlog (including descendant backlogs). */
export function useBacklogFinancialTotals(backlogId: string, treeId: string): FinancialTotals {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const displayCurrency = useDisplayCurrencyStore((s) => s.displayCurrency);
  const rates = useRatesStore((s) => s.rates);
  return useMemo(() => {
    const backlogIds = new Set<string>();
    const collectBacklogs = (id: string) => {
      backlogIds.add(id);
      backlogs[id]?.childrenIds.forEach(collectBacklogs);
    };
    collectBacklogs(backlogId);
    const ids: string[] = [];
    for (const wi of Object.values(workItems)) {
      const wiBacklog = wi.backlogAssignments[treeId];
      if (wiBacklog && backlogIds.has(wiBacklog)) ids.push(wi.id);
    }
    return rollup(ids, byWorkItem, displayCurrency, rates);
  }, [backlogId, treeId, workItems, backlogs, byWorkItem, displayCurrency, rates]);
}

/** Sum of financial entries for every work item assigned to a tree. */
export function useTreeFinancialTotals(treeId: string): FinancialTotals {
  const workItems = useAppStore((s) => s.workItems);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const displayCurrency = useDisplayCurrencyStore((s) => s.displayCurrency);
  const rates = useRatesStore((s) => s.rates);
  return useMemo(() => {
    const ids: string[] = [];
    for (const wi of Object.values(workItems)) {
      if (treeId in wi.backlogAssignments) ids.push(wi.id);
    }
    return rollup(ids, byWorkItem, displayCurrency, rates);
  }, [treeId, workItems, byWorkItem, displayCurrency, rates]);
}
