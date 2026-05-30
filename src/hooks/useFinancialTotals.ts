import { useMemo } from "react";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, sumMap } from "@/store/financialsStore";

interface FinancialTotals {
  savings: number;
  income: number;
  /** Most common currency among contributing items, defaults to EUR. */
  currency: string;
  /** True when at least one work item in scope has any financial entry. */
  hasData: boolean;
}

function rollup(
  workItemIds: Iterable<string>,
  byWorkItem: Record<string, ReturnType<typeof useFinancialsStore.getState>["byWorkItem"][string]>,
): FinancialTotals {
  let savings = 0;
  let income = 0;
  let hasData = false;
  const currencyCounts: Record<string, number> = {};
  for (const id of workItemIds) {
    const e = byWorkItem[id];
    if (!e) continue;
    const s = sumMap(e.savingsByMonth);
    const i = sumMap(e.incomeByMonth);
    if (s === 0 && i === 0) continue;
    hasData = true;
    savings += s;
    income += i;
    currencyCounts[e.currency] = (currencyCounts[e.currency] ?? 0) + 1;
  }
  let currency = "EUR";
  let max = 0;
  for (const [c, n] of Object.entries(currencyCounts)) {
    if (n > max) {
      max = n;
      currency = c;
    }
  }
  return { savings, income, currency, hasData };
}

/** Sum of financial entries for a work item and all its descendants. */
export function useWorkItemFinancialTotals(workItemId: string): FinancialTotals {
  const workItems = useAppStore((s) => s.workItems);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  return useMemo(() => {
    const ids: string[] = [];
    const collect = (id: string) => {
      ids.push(id);
      workItems[id]?.childrenIds.forEach(collect);
    };
    collect(workItemId);
    return rollup(ids, byWorkItem);
  }, [workItemId, workItems, byWorkItem]);
}

/** Sum of financial entries for a backlog (including descendant backlogs). */
export function useBacklogFinancialTotals(backlogId: string, treeId: string): FinancialTotals {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
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
    return rollup(ids, byWorkItem);
  }, [backlogId, treeId, workItems, backlogs, byWorkItem]);
}

/** Sum of financial entries for every work item assigned to a tree. */
export function useTreeFinancialTotals(treeId: string): FinancialTotals {
  const workItems = useAppStore((s) => s.workItems);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  return useMemo(() => {
    const ids: string[] = [];
    for (const wi of Object.values(workItems)) {
      if (treeId in wi.backlogAssignments) ids.push(wi.id);
    }
    return rollup(ids, byWorkItem);
  }, [treeId, workItems, byWorkItem]);
}
