import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AreaChart,
  Area,
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
import { Label } from "@/components/ui/label";
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { ChevronLeft, ChevronRight, Settings2, Target as TargetIcon } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, isPastMonth, type MonthlyMap } from "@/store/financialsStore";
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

type GroupBy = "type" | "item" | "status" | "list";

const GROUP_BY_OPTIONS: { value: GroupBy; label: string; description: string }[] = [
  { value: "type", label: "Financials type", description: "Income vs savings" },
  { value: "item", label: "Item", description: "One area per work item" },
  { value: "status", label: "Item status", description: "Grouped by current status" },
  { value: "list", label: "List", description: "Grouped by backlog list" },
];

const CHART_COLORS = [
  "#6366f1", "#f59e0b", "#10b981", "#3b82f6", "#ef4444",
  "#8b5cf6", "#06b6d4", "#84cc16", "#f97316", "#ec4899",
];

interface Props {
  treeId: string;
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

export function CumulativeFlowChart({ treeId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [metric, setMetric] = useState<TargetMetric>("both");
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [groupBy, setGroupBy] = useState<GroupBy>("type");
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const statusesList = useTreeStatusesStore((s) => s.statusesByTree[treeId]);
  const displayCurrency = useDisplayCurrencyStore((s) => s.displayCurrency);
  const setDisplayCurrency = useDisplayCurrencyStore((s) => s.setDisplayCurrency);
  const rates = useRatesStore((s) => s.rates);
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
    // "list"
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
  }, [groupBy, statuses, treeItemIds, workItems, backlogs, treeId, getPlanMap, getActualMap]);

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
          let seriesKey: string;
          if (groupBy === "status") seriesKey = wi.status;
          else if (groupBy === "item") seriesKey = id;
          else seriesKey = wi.backlogAssignments[treeId];
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
      return row;
    });
  }, [series, groupBy, treeItemIds, byWorkItem, workItems, treeId, getPlanMap, getActualMap, year, displayCurrency, rates]);

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

  const dialogMetric = metric === "both" ? "savings" : metric;

  function openTargetDialog() {
    const t = dialogMetric === "savings" ? targetSavings : targetIncome;
    setTargetInput(t ? String(t.amount) : "");
    setTargetDialogOpen(true);
  }

  async function saveTarget() {
    if (!ownerOrgId) return;
    const n = Number(targetInput);
    if (!Number.isFinite(n) || n < 0) return;
    if (n === 0) {
      const t = dialogMetric === "savings" ? targetSavings : targetIncome;
      if (t) await removeTarget(treeId, year, dialogMetric);
    } else {
      await upsertTarget(treeId, ownerOrgId, year, dialogMetric, n, currency);
    }
    setTargetDialogOpen(false);
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
            Cumulative {metricLabel} · {year}
          </h4>
          <p className="text-[10px] text-muted-foreground">
            Sliced by {groupByLabel.toLowerCase()} · {currency}{" "}
            {yearTotal.toLocaleString(undefined, { maximumFractionDigits: 0 })}
            {hasTarget ? (
              <>
                {" · target "}
                <span className="text-destructive font-medium">
                  {currency} {target!.amount.toLocaleString(undefined, { maximumFractionDigits: 0 })}
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
          <Dialog open={targetDialogOpen} onOpenChange={setTargetDialogOpen}>
            <DialogTrigger asChild>
              <Button
                size="sm"
                variant="outline"
                className="h-6 px-2 text-[10px] gap-1"
                onClick={openTargetDialog}
              >
                <TargetIcon className="h-3 w-3" />
                Target
              </Button>
            </DialogTrigger>
            <DialogContent className="sm:max-w-sm">
              <DialogHeader>
                <DialogTitle>
                  {dialogMetric === "savings" ? "Savings" : "Income"} target · {year}
                </DialogTitle>
              </DialogHeader>
              <div className="space-y-2">
                <Label htmlFor="target-amount" className="text-xs">
                  Annual target ({currency}). Set to 0 to clear.
                </Label>
                <Input
                  id="target-amount"
                  type="number"
                  min="0"
                  step="0.01"
                  value={targetInput}
                  onChange={(e) => setTargetInput(e.target.value)}
                  autoFocus
                />
              </div>
              <DialogFooter>
                <Button variant="ghost" onClick={() => setTargetDialogOpen(false)}>
                  Cancel
                </Button>
                <Button onClick={saveTarget}>Save</Button>
              </DialogFooter>
            </DialogContent>
          </Dialog>
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
        </div>
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis
              dataKey="label"
              tick={{ fontSize: 10 }}
              minTickGap={8}
            />
            <YAxis
              tick={{ fontSize: 10 }}
              width={48}
              tickFormatter={(v: number) =>
                v >= 1000 ? `${(v / 1000).toFixed(0)}k` : String(v)
              }
            />
            <RechartsTooltip
              contentStyle={{ fontSize: 11 }}
              formatter={(value: number, name: string) => [
                `${currency} ${Number(value).toLocaleString(undefined, { maximumFractionDigits: 0 })}`,
                series.find((s) => s.key === name)?.label ?? name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            {series.map((s) => (
              <Area
                key={s.key}
                type="monotone"
                dataKey={s.key}
                stackId="1"
                name={s.label}
                stroke={s.color}
                fill={s.color}
                fillOpacity={0.75}
              />
            ))}
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
        </ResponsiveContainer>
      </div>
    </div>
  );
}
