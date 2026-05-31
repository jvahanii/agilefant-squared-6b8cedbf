import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, ExternalLink, Settings2 } from "lucide-react";
import { PopoutWindow } from "@/components/PopoutWindow";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, isPastMonth, type MonthlyMap } from "@/store/financialsStore";
import { useTeamStore } from "@/store/teamStore";
import { useTargetsStore, type TargetMetric } from "@/store/targetsStore";
import { useTreeStatusesStore, DEFAULT_TREE_STATUSES } from "@/store/treeStatusesStore";
import { useDisplayCurrencyStore } from "@/store/displayCurrencyStore";
import { useRatesStore, convertCurrency } from "@/store/ratesStore";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

const DISPLAY_CURRENCIES = ["EUR", "USD", "GBP", "JPY", "AUD", "CAD", "CHF", "SEK", "NOK", "DKK"];

type GroupBy = "type" | "item" | "status" | "list" | "team";

const GROUP_BY_OPTIONS: { value: GroupBy; label: string; description: string }[] = [
  { value: "type", label: "Financials type", description: "Income vs savings" },
  { value: "item", label: "Item", description: "One area per work item" },
  { value: "status", label: "Item status", description: "Grouped by current status" },
  { value: "list", label: "List", description: "Grouped by backlog list" },
  { value: "team", label: "Team", description: "Grouped by assigned team" },
];

const CHART_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#ef4444",
  "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899",
];

interface Props {
  treeId: string;
  /** True when this chart is already rendered inside a PopoutWindow – hides the
   *  "open in new window" button to prevent infinite window chains. */
  inPopout?: boolean;
}

const MONTHS_OF_YEAR = Array.from({ length: 12 }, (_, i) =>
  String(i + 1).padStart(2, "0"),
);

function monthLabel(monthNum: number): string {
  return new Date(Date.UTC(2020, monthNum - 1, 1)).toLocaleString(undefined, {
    month: "short",
  });
}

function sumMaps(a: MonthlyMap | undefined, b: MonthlyMap | undefined): MonthlyMap {
  const out: MonthlyMap = {};
  for (const [k, v] of Object.entries(a || {})) if (v) out[k] = (out[k] || 0) + v;
  for (const [k, v] of Object.entries(b || {})) if (v) out[k] = (out[k] || 0) + v;
  return out;
}

export function CumulativeFlowChart({ treeId, inPopout = false }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [metric, setMetric] = useState<TargetMetric>("both");
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [chartType, setChartType] = useState<"area" | "bar">(() => {
    try {
      const v = localStorage.getItem("financials-chart-type-v1");
      return v === "bar" ? "bar" : "area";
    } catch {
      return "area";
    }
  });
  useEffect(() => {
    try { localStorage.setItem("financials-chart-type-v1", chartType); } catch { /* ignore */ }
  }, [chartType]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [editingTarget, setEditingTarget] = useState(false);
  const [targetInput, setTargetInput] = useState("");
  const [poppedOut, setPoppedOut] = useState(false);

  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const statusesList = useTreeStatusesStore((s) => s.statusesByTree[treeId]);
  const displayCurrency = useDisplayCurrencyStore((s) => s.displayCurrency);
  const setDisplayCurrency = useDisplayCurrencyStore((s) => s.setDisplayCurrency);
  const rates = useRatesStore((s) => s.rates);
  const workItemTeams = useTeamStore((s) => s.workItemTeams);
  const teams = useTeamStore((s) => s.teams);
  const rawTargetSavings = useTargetsStore((s) => s.byKey[`${treeId}::${year}::savings`]);
  const rawTargetIncome = useTargetsStore((s) => s.byKey[`${treeId}::${year}::income`]);
  const rawTargetSingle = useTargetsStore((s) => s.byKey[`${treeId}::${year}::${metric}`]);
  // Convert target amounts to display currency for the reference line.
  const targetSavings = rawTargetSavings
    ? { ...rawTargetSavings, amount: convertCurrency(rawTargetSavings.amount, rawTargetSavings.currency, displayCurrency, rates) }
    : undefined;
  const targetIncome = rawTargetIncome
    ? { ...rawTargetIncome, amount: convertCurrency(rawTargetIncome.amount, rawTargetIncome.currency, displayCurrency, rates) }
    : undefined;
  const targetSingle = rawTargetSingle
    ? { ...rawTargetSingle, amount: convertCurrency(rawTargetSingle.amount, rawTargetSingle.currency, displayCurrency, rates) }
    : undefined;
  const target = metric === "both"
    ? (targetSavings || targetIncome
        ? {
            ...((targetSavings ?? targetIncome)!),
            amount: (targetSavings?.amount || 0) + (targetIncome?.amount || 0),
            metric: "both" as TargetMetric,
          }
        : undefined)
    : targetSingle;
  const upsertTarget = useTargetsStore((s) => s.upsert);
  const removeTarget = useTargetsStore((s) => s.remove);

  const ownerOrgId = useMemo(() => {
    const sep = treeId.indexOf("::");
    return sep > 0 ? treeId.slice(0, sep) : "";
  }, [treeId]);

  const statuses = useMemo(() => {
    const list = statusesList && statusesList.length > 0 ? statusesList : DEFAULT_TREE_STATUSES;
    return [...list]
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((s) => ({ key: s.key, label: s.label, color: s.color }));
  }, [statusesList]);

  /** Resolve the plan financial map for a work item depending on current metric. */
  const getPlanMap = useCallback((id: string): MonthlyMap | undefined => {
    const e = byWorkItem[id];
    if (!e) return undefined;
    if (metric === "savings") return e.savingsByMonth;
    if (metric === "income") return e.incomeByMonth;
    return sumMaps(e.savingsByMonth, e.incomeByMonth);
  }, [byWorkItem, metric]);

  /** Resolve the actual (realized) financial map for a work item. */
  const getActualMap = useCallback((id: string): MonthlyMap | undefined => {
    const e = byWorkItem[id];
    if (!e) return undefined;
    if (metric === "savings") return e.actualSavingsByMonth;
    if (metric === "income") return e.actualIncomeByMonth;
    return sumMaps(e.actualSavingsByMonth, e.actualIncomeByMonth);
  }, [byWorkItem, metric]);

  /** IDs of work items in this tree that have relevant financials. */
  const treeItemIds = useMemo(() => {
    return Object.keys(byWorkItem).filter((id) => {
      const wi = workItems[id];
      return wi && treeId in wi.backlogAssignments;
    });
  }, [byWorkItem, workItems, treeId]);

  /** Ordered series definitions (key, label, color) for the chart. */
  const series = useMemo(() => {
    if (groupBy === "type") {
      return [
        { key: "savings", label: "Savings", color: "#22c55e" },
        { key: "income", label: "Income", color: "#3b82f6" },
      ];
    }
    if (groupBy === "status") {
      return statuses;
    }
    if (groupBy === "item") {
      const items = treeItemIds.filter((id) => {
        const plan = getPlanMap(id);
        const actual = getActualMap(id);
        return (plan && Object.keys(plan).length > 0) || (actual && Object.keys(actual).length > 0);
      });
      return items.map((id, i) => ({
        key: id,
        label: workItems[id]?.title ?? id,
        color: CHART_COLORS[i % CHART_COLORS.length],
      }));
    }
    if (groupBy === "list") {
      const seen = new Map<string, { key: string; label: string; color: string }>();
      let colorIdx = 0;
      for (const id of treeItemIds) {
        const wi = workItems[id];
        if (!wi) continue;
        const backlogId = wi.backlogAssignments[treeId];
        if (!backlogId || seen.has(backlogId)) continue;
        const plan = getPlanMap(id);
        const actual = getActualMap(id);
        if ((!plan || Object.keys(plan).length === 0) && (!actual || Object.keys(actual).length === 0)) continue;
        seen.set(backlogId, {
          key: backlogId,
          label: backlogs[backlogId]?.name ?? backlogId,
          color: CHART_COLORS[colorIdx % CHART_COLORS.length],
        });
        colorIdx++;
      }
      return Array.from(seen.values());
    }
    // "team"
    const teamsById = new Map(teams.map((t) => [t.id, t]));
    const teamsMap = new Map<string, { key: string; label: string; color: string }>();
    let teamColorIdx = 0;
    let hasUnassigned = false;
    for (const id of treeItemIds) {
      const plan = getPlanMap(id);
      const actual = getActualMap(id);
      if ((!plan || Object.keys(plan).length === 0) && (!actual || Object.keys(actual).length === 0)) continue;
      const tids = workItemTeams[id] ?? [];
      if (tids.length === 0) {
        hasUnassigned = true;
      } else {
        for (const teamId of tids) {
          if (!teamsMap.has(teamId)) {
            teamsMap.set(teamId, {
              key: teamId,
              label: teamsById.get(teamId)?.name ?? teamId,
              color: CHART_COLORS[teamColorIdx % CHART_COLORS.length],
            });
            teamColorIdx++;
          }
        }
      }
    }
    const teamSeries = Array.from(teamsMap.values());
    if (hasUnassigned) {
      teamSeries.push({
        key: "__unassigned__",
        label: "Unassigned",
        color: CHART_COLORS[teamColorIdx % CHART_COLORS.length],
      });
    }
    return teamSeries;
  }, [groupBy, statuses, treeItemIds, workItems, backlogs, treeId, getPlanMap, getActualMap, workItemTeams, teams]);

  const data = useMemo(() => {
    return MONTHS_OF_YEAR.map((mm) => {
      const monthIdx0 = Number(mm) - 1;
      const mk = `${year}-${mm}`;
      const past = isPastMonth(year, monthIdx0);
      const row: Record<string, number | string | null> = { month: mk, label: monthLabel(Number(mm)) };
      // Initialize plan keys to 0 and actual keys to null (so the line breaks for non-past months).
      for (const s of series) {
        row[`${s.key}_plan`] = 0;
        row[`${s.key}_actual`] = past ? 0 : null;
      }

      if (groupBy === "type") {
        for (const id of treeItemIds) {
          const e = byWorkItem[id];
          if (!e) continue;
          let accruedPlanS = 0, accruedPlanI = 0, accruedActS = 0, accruedActI = 0;
          for (const [k, v] of Object.entries(e.savingsByMonth ?? {})) {
            if (k.startsWith(`${year}-`) && k <= mk) accruedPlanS += v;
          }
          for (const [k, v] of Object.entries(e.incomeByMonth ?? {})) {
            if (k.startsWith(`${year}-`) && k <= mk) accruedPlanI += v;
          }
          if (past) {
            for (const [k, v] of Object.entries(e.actualSavingsByMonth ?? {})) {
              if (k.startsWith(`${year}-`) && k <= mk) accruedActS += v;
            }
            for (const [k, v] of Object.entries(e.actualIncomeByMonth ?? {})) {
              if (k.startsWith(`${year}-`) && k <= mk) accruedActI += v;
            }
          }
          row["savings_plan"] = (row["savings_plan"] as number) + convertCurrency(accruedPlanS, e.currency, displayCurrency, rates);
          row["income_plan"] = (row["income_plan"] as number) + convertCurrency(accruedPlanI, e.currency, displayCurrency, rates);
          if (past) {
            row["savings_actual"] = (row["savings_actual"] as number) + convertCurrency(accruedActS, e.currency, displayCurrency, rates);
            row["income_actual"] = (row["income_actual"] as number) + convertCurrency(accruedActI, e.currency, displayCurrency, rates);
          }
        }
      } else {
        for (const id of treeItemIds) {
          const wi = workItems[id];
          if (!wi) continue;
          const e = byWorkItem[id];
          const planMap = getPlanMap(id);
          const actualMap = getActualMap(id);
          if (!e) continue;
          let seriesKeys: string[];
          if (groupBy === "status") seriesKeys = [wi.status];
          else if (groupBy === "item") seriesKeys = [id];
          else if (groupBy === "team") {
            const tids = workItemTeams[id] ?? [];
            seriesKeys = tids.length > 0 ? tids : ["__unassigned__"];
          } else seriesKeys = [wi.backlogAssignments[treeId]];

          for (const seriesKey of seriesKeys) {
            const planKey = `${seriesKey}_plan`;
            const actualKey = `${seriesKey}_actual`;
            if (row[planKey] === undefined) continue;

            let accruedPlan = 0;
            for (const [k, v] of Object.entries(planMap ?? {})) {
              if (k.startsWith(`${year}-`) && k <= mk) accruedPlan += v;
            }
            if (accruedPlan > 0) {
              row[planKey] = (row[planKey] as number) + convertCurrency(accruedPlan, e.currency, displayCurrency, rates);
            }
            if (past) {
              let accruedAct = 0;
              for (const [k, v] of Object.entries(actualMap ?? {})) {
                if (k.startsWith(`${year}-`) && k <= mk) accruedAct += v;
              }
              if (accruedAct > 0) {
                row[actualKey] = (row[actualKey] as number) + convertCurrency(accruedAct, e.currency, displayCurrency, rates);
              }
            }
          }
        }
      }
      return row;
    });
  }, [series, groupBy, treeItemIds, byWorkItem, workItems, treeId, getPlanMap, getActualMap, year, displayCurrency, rates, workItemTeams]);

  // Non-cumulative per-month data for the bar chart.
  const barData = useMemo(() => {
    return MONTHS_OF_YEAR.map((mm) => {
      const monthIdx0 = Number(mm) - 1;
      const mk = `${year}-${mm}`;
      const past = isPastMonth(year, monthIdx0);
      const row: Record<string, number | string | null> = { month: mk, label: monthLabel(Number(mm)) };
      for (const s of series) {
        row[`${s.key}_plan`] = 0;
        row[`${s.key}_actual`] = past ? 0 : null;
      }

      if (groupBy === "type") {
        for (const id of treeItemIds) {
          const e = byWorkItem[id];
          if (!e) continue;
          const ps = e.savingsByMonth?.[mk] || 0;
          const pi = e.incomeByMonth?.[mk] || 0;
          row["savings_plan"] = (row["savings_plan"] as number) + convertCurrency(ps, e.currency, displayCurrency, rates);
          row["income_plan"] = (row["income_plan"] as number) + convertCurrency(pi, e.currency, displayCurrency, rates);
          if (past) {
            const as = e.actualSavingsByMonth?.[mk] || 0;
            const ai = e.actualIncomeByMonth?.[mk] || 0;
            row["savings_actual"] = (row["savings_actual"] as number) + convertCurrency(as, e.currency, displayCurrency, rates);
            row["income_actual"] = (row["income_actual"] as number) + convertCurrency(ai, e.currency, displayCurrency, rates);
          }
        }
      } else {
        for (const id of treeItemIds) {
          const wi = workItems[id];
          if (!wi) continue;
          const e = byWorkItem[id];
          if (!e) continue;
          const planMap = getPlanMap(id);
          const actualMap = getActualMap(id);
          let seriesKeys: string[];
          if (groupBy === "status") seriesKeys = [wi.status];
          else if (groupBy === "item") seriesKeys = [id];
          else if (groupBy === "team") {
            const tids = workItemTeams[id] ?? [];
            seriesKeys = tids.length > 0 ? tids : ["__unassigned__"];
          } else seriesKeys = [wi.backlogAssignments[treeId]];

          for (const seriesKey of seriesKeys) {
            const planKey = `${seriesKey}_plan`;
            const actualKey = `${seriesKey}_actual`;
            if (row[planKey] === undefined) continue;

            const p = planMap?.[mk] || 0;
            if (p) row[planKey] = (row[planKey] as number) + convertCurrency(p, e.currency, displayCurrency, rates);
            if (past) {
              const a = actualMap?.[mk] || 0;
              if (a) row[actualKey] = (row[actualKey] as number) + convertCurrency(a, e.currency, displayCurrency, rates);
            }
          }
        }
      }
      return row;
    });
  }, [series, groupBy, treeItemIds, byWorkItem, workItems, treeId, getPlanMap, getActualMap, year, displayCurrency, rates, workItemTeams]);

  const currency = displayCurrency;

  // Year total reflects the plan (full year). Past months alone wouldn't show
  // upcoming planned activity in the header readout.
  const yearTotal = data.length > 0
    ? series.reduce((sum, s) => sum + ((data[data.length - 1][`${s.key}_plan`] as number) || 0), 0)
    : 0;

  const hasData = treeItemIds.length > 0;
  const hasTarget = target && target.amount > 0;

  // Scroll into view on first mount so the user doesn't need to scroll manually
  // after clicking a tree/backlog/work item that triggers the chart to appear.
  useEffect(() => {
    if (!containerRef.current) return;
    containerRef.current.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }, []);

  if (!hasData && !hasTarget) return null;

  // When popped out, render a fresh independent chart instance in a new browser
  // window (sharing the same Zustand stores) and show a placeholder inline.
  if (poppedOut && !inPopout) {
    return (
      <>
        <PopoutWindow
          content={<CumulativeFlowChart treeId={treeId} inPopout />}
          title="Financial Chart"
          onClose={() => setPoppedOut(false)}
        />
        <div className="mt-2 rounded-md border bg-card p-3 flex items-center justify-between gap-3">
          <p className="text-xs text-muted-foreground">
            Financial chart is open in a separate window.
          </p>
          <Button
            variant="ghost"
            size="sm"
            className="h-6 text-xs shrink-0"
            onClick={() => setPoppedOut(false)}
          >
            Close external window
          </Button>
        </div>
      </>
    );
  }

  const dialogMetric = metric === "both" ? "savings" : metric;

  function openInlineTargetEdit() {
    if (!ownerOrgId) return;
    const t = dialogMetric === "savings" ? targetSavings : targetIncome;
    setTargetInput(t ? String(t.amount) : "");
    setEditingTarget(true);
  }

  async function saveTarget() {
    if (!ownerOrgId) return;
    const n = Number(targetInput);
    if (!Number.isFinite(n) || n < 0) { setEditingTarget(false); return; }
    if (n === 0) {
      const t = dialogMetric === "savings" ? targetSavings : targetIncome;
      if (t) await removeTarget(treeId, year, dialogMetric);
    } else {
      await upsertTarget(treeId, ownerOrgId, year, dialogMetric, n, currency);
    }
    setEditingTarget(false);
  }

  const groupByLabel = GROUP_BY_OPTIONS.find((o) => o.value === groupBy)?.label ?? groupBy;

  const metricLabel =
    groupBy === "type"
      ? "Savings + Income"
      : metric === "both"
      ? "Savings + Income"
      : metric === "savings"
      ? "Savings"
      : "Income";

  return (
    <div ref={containerRef} className="mt-2 rounded-md border bg-card p-2">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            {chartType === "area" ? "Cumulative" : "Monthly"} {metricLabel} · {year}
          </h4>
          <p className="text-[10px] text-muted-foreground">
            Sliced by {groupByLabel.toLowerCase()} · {currency}{" "}
            {yearTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            {editingTarget ? (
              <>
                {" · target "}
                <Input
                  type="number"
                  min="0"
                  step="0.01"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  onBlur={saveTarget}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") saveTarget();
                    if (e.key === "Escape") setEditingTarget(false);
                  }}
                  autoFocus
                  aria-label="Edit target amount"
                  className="inline h-4 w-24 px-1 py-0 text-[10px] align-baseline"
                />
              </>
            ) : hasTarget ? (
              <>
                {" · target "}
                <span
                  className="text-destructive font-medium cursor-pointer"
                  title="Double-click to edit target"
                  role="button"
                  tabIndex={0}
                  onDoubleClick={openInlineTargetEdit}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openInlineTargetEdit(); }}
                >
                  {currency} {target!.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
                </span>
              </>
            ) : ownerOrgId ? (
              <>
                {" · "}
                <span
                  className="text-muted-foreground/50 cursor-pointer hover:text-muted-foreground"
                  title="Double-click to set target"
                  role="button"
                  tabIndex={0}
                  onDoubleClick={openInlineTargetEdit}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") openInlineTargetEdit(); }}
                >
                  set target
                </span>
              </>
            ) : null}
          </p>
        </div>
        <div className="flex items-center gap-1 flex-wrap">
          <div className="flex items-center gap-0.5">
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => setYear((y) => y - 1)}
              aria-label="Previous year"
            >
              <ChevronLeft className="h-3 w-3" />
            </Button>
            <span className="text-[10px] tabular-nums w-10 text-center">{year}</span>
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => setYear((y) => y + 1)}
              aria-label="Next year"
            >
              <ChevronRight className="h-3 w-3" />
            </Button>
          </div>
          <div className="flex gap-0.5 rounded border p-0.5">
            <Button
              size="sm"
              variant={chartType === "area" ? "default" : "ghost"}
              className="h-5 px-2 text-[10px]"
              onClick={() => setChartType("area")}
            >
              Cumulative
            </Button>
            <Button
              size="sm"
              variant={chartType === "bar" ? "default" : "ghost"}
              className="h-5 px-2 text-[10px]"
              onClick={() => setChartType("bar")}
            >
              Monthly
            </Button>
          </div>
          <Select value={displayCurrency} onValueChange={setDisplayCurrency}>
            <SelectTrigger className="h-6 px-2 text-[10px] w-[72px]" aria-label="Display currency">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {DISPLAY_CURRENCIES.map((c) => (
                <SelectItem key={c} value={c} className="text-xs">{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          {groupBy !== "type" && (
            <div className="flex gap-1">
              <Button
                size="sm"
                variant={metric === "both" ? "default" : "ghost"}
                className="h-6 px-2 text-[10px]"
                onClick={() => setMetric("both")}
              >
                Both
              </Button>
              <Button
                size="sm"
                variant={metric === "savings" ? "default" : "ghost"}
                className="h-6 px-2 text-[10px]"
                onClick={() => setMetric("savings")}
              >
                Savings
              </Button>
              <Button
                size="sm"
                variant={metric === "income" ? "default" : "ghost"}
                className="h-6 px-2 text-[10px]"
                onClick={() => setMetric("income")}
              >
                Income
              </Button>
            </div>
          )}
          <Popover open={settingsOpen} onOpenChange={setSettingsOpen}>
            <PopoverTrigger asChild>
              <Button
                size="sm"
                variant="ghost"
                className="h-6 w-6 p-0"
                aria-label="Chart settings"
              >
                <Settings2 className="h-3 w-3" />
              </Button>
            </PopoverTrigger>
            <PopoverContent className="w-52 p-2" align="end">
              <p className="text-[10px] font-semibold uppercase tracking-wider text-muted-foreground mb-2 px-1">
                Count by
              </p>
              <div className="space-y-0.5">
                {GROUP_BY_OPTIONS.map((opt) => (
                  <button
                    key={opt.value}
                    type="button"
                    onClick={() => {
                      setGroupBy(opt.value);
                      setSettingsOpen(false);
                    }}
                    className={`w-full flex flex-col items-start rounded px-2 py-1.5 text-left transition-colors ${
                      groupBy === opt.value
                        ? "bg-primary text-primary-foreground"
                        : "hover:bg-muted"
                    }`}
                  >
                    <span className="text-xs font-medium">{opt.label}</span>
                    <span className={`text-[10px] ${groupBy === opt.value ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                      {opt.description}
                    </span>
                  </button>
                ))}
              </div>
            </PopoverContent>
          </Popover>
          {!inPopout && (
            <Button
              size="sm"
              variant="ghost"
              className="h-6 w-6 p-0"
              onClick={() => setPoppedOut(true)}
              aria-label="Open chart in new window"
              title="Open in new window"
            >
              <ExternalLink className="h-3 w-3" />
            </Button>
          )}
        </div>
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          {chartType === "area" ? (
            <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={8} />
              <YAxis
                tick={{ fontSize: 10 }}
                width={48}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                }
              />
              <RechartsTooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(value: number, name: string) => {
                  const isPlan = name.endsWith("_plan");
                  const baseKey = name.replace(/_(plan|actual)$/, "");
                  const label = series.find((s) => s.key === baseKey)?.label ?? baseKey;
                  return [
                    `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    `${label} · ${isPlan ? "Plan" : "Actual"}`,
                  ];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                iconSize={8}
                formatter={(value: string) => {
                  const isPlan = value.endsWith("_plan");
                  const baseKey = value.replace(/_(plan|actual)$/, "");
                  const label = series.find((s) => s.key === baseKey)?.label ?? baseKey;
                  return `${label} · ${isPlan ? "Plan" : "Actual"}`;
                }}
              />
              {series.map((s) => (
                <Area
                  key={`${s.key}_plan`}
                  type="monotone"
                  dataKey={`${s.key}_plan`}
                  stackId="plan"
                  name={`${s.key}_plan`}
                  stroke={s.color}
                  strokeDasharray="4 4"
                  strokeOpacity={0.8}
                  fill={s.color}
                  fillOpacity={0.18}
                  isAnimationActive={false}
                />
              ))}
              {series.map((s) => (
                <Area
                  key={`${s.key}_actual`}
                  type="monotone"
                  dataKey={`${s.key}_actual`}
                  stackId="actual"
                  name={`${s.key}_actual`}
                  stroke={s.color}
                  strokeWidth={2}
                  fill={s.color}
                  fillOpacity={0.55}
                  connectNulls={false}
                  isAnimationActive={false}
                />
              ))}
              {year === new Date().getUTCFullYear() ? (
                <ReferenceLine
                  x={monthLabel(new Date().getUTCMonth() + 1)}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 2"
                  label={{ value: "today", position: "top", fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                />
              ) : null}
              {hasTarget ? (
                <ReferenceLine
                  y={target!.amount}
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: `Target ${currency} ${target!.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "hsl(var(--destructive))",
                  }}
                />
              ) : null}
            </AreaChart>
          ) : (
            <BarChart data={barData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }} barCategoryGap="20%">
              <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
              <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={8} />
              <YAxis
                tick={{ fontSize: 10 }}
                width={48}
                tickFormatter={(v: number) =>
                  v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
                }
              />
              <RechartsTooltip
                contentStyle={{ fontSize: 11 }}
                formatter={(value: number, name: string) => {
                  const isPlan = name.endsWith("_plan");
                  const baseKey = name.replace(/_(plan|actual)$/, "");
                  const label = series.find((s) => s.key === baseKey)?.label ?? baseKey;
                  return [
                    `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    `${label} · ${isPlan ? "Plan" : "Actual"}`,
                  ];
                }}
              />
              <Legend
                wrapperStyle={{ fontSize: 10 }}
                iconSize={8}
                formatter={(value: string) => {
                  const isPlan = value.endsWith("_plan");
                  const baseKey = value.replace(/_(plan|actual)$/, "");
                  const label = series.find((s) => s.key === baseKey)?.label ?? baseKey;
                  return `${label} · ${isPlan ? "Plan" : "Actual"}`;
                }}
              />
              {series.map((s) => (
                <Bar
                  key={`${s.key}_plan`}
                  dataKey={`${s.key}_plan`}
                  stackId="plan"
                  name={`${s.key}_plan`}
                  fill={s.color}
                  fillOpacity={0.45}
                  stroke={s.color}
                  strokeOpacity={0.6}
                  strokeDasharray="3 3"
                  isAnimationActive={false}
                />
              ))}
              {series.map((s) => (
                <Bar
                  key={`${s.key}_actual`}
                  dataKey={`${s.key}_actual`}
                  stackId="actual"
                  name={`${s.key}_actual`}
                  fill={s.color}
                  fillOpacity={0.95}
                  isAnimationActive={false}
                />
              ))}
              {year === new Date().getUTCFullYear() ? (
                <ReferenceLine
                  x={monthLabel(new Date().getUTCMonth() + 1)}
                  stroke="hsl(var(--muted-foreground))"
                  strokeDasharray="2 2"
                  label={{ value: "today", position: "top", fontSize: 9, fill: "hsl(var(--muted-foreground))" }}
                />
              ) : null}
              {hasTarget ? (
                <ReferenceLine
                  y={target!.amount / 12}
                  stroke="hsl(var(--destructive))"
                  strokeWidth={2}
                  strokeDasharray="4 4"
                  ifOverflow="extendDomain"
                  label={{
                    value: `Average monthly target ${currency} ${(target!.amount / 12).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                    position: "insideTopRight",
                    fontSize: 10,
                    fill: "hsl(var(--destructive))",
                  }}
                />
              ) : null}
            </BarChart>
          )}
        </ResponsiveContainer>
      </div>
    </div>
  );
}
