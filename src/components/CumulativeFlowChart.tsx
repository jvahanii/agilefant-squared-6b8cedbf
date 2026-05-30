import { useMemo, useState } from "react";
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
import { ChevronLeft, ChevronRight, Target as TargetIcon } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, type MonthlyMap } from "@/store/financialsStore";
import { useTargetsStore, type TargetMetric } from "@/store/targetsStore";
import { useTreeStatusesStore, DEFAULT_TREE_STATUSES } from "@/store/treeStatusesStore";

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
  const [metric, setMetric] = useState<TargetMetric>("both");
  const [year, setYear] = useState<number>(new Date().getUTCFullYear());
  const [targetDialogOpen, setTargetDialogOpen] = useState(false);
  const [targetInput, setTargetInput] = useState("");

  const workItems = useAppStore((s) => s.workItems);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const statusesList = useTreeStatusesStore((s) => s.statusesByTree[treeId]);
  const targetSavings = useTargetsStore((s) => s.byKey[`${treeId}::${year}::savings`]);
  const targetIncome = useTargetsStore((s) => s.byKey[`${treeId}::${year}::income`]);
  const targetSingle = useTargetsStore((s) => s.byKey[`${treeId}::${year}::${metric}`]);
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

  const contributors = useMemo(() => {
    const out: Array<{ status: string; entries: MonthlyMap; currency: string }> = [];
    for (const id of Object.keys(byWorkItem)) {
      const wi = workItems[id];
      if (!wi) continue;
      if (!(treeId in wi.backlogAssignments)) continue;
      const e = byWorkItem[id];
      let map: MonthlyMap | undefined;
      if (metric === "both") {
        map = sumMaps(e.savingsByMonth, e.incomeByMonth);
      } else {
        map = metric === "savings" ? e.savingsByMonth : e.incomeByMonth;
      }
      if (!map || Object.keys(map).length === 0) continue;
      out.push({ status: wi.status, entries: map, currency: e.currency });
    }
    return out;
  }, [byWorkItem, workItems, treeId, metric]);

  const data = useMemo(() => {
    return MONTHS_OF_YEAR.map((mm) => {
      const mk = `${year}-${mm}`;
      const row: Record<string, number | string> = { month: mk, label: monthLabel(Number(mm)) };
      for (const s of statuses) row[s.key] = 0;
      for (const c of contributors) {
        let accrued = 0;
        for (const [k, v] of Object.entries(c.entries)) {
          if (k.startsWith(`${year}-`) && k <= mk) accrued += v;
        }
        if (accrued > 0) row[c.status] = (row[c.status] as number) + accrued;
      }
      return row;
    });
  }, [contributors, statuses, year]);

  const currency = contributors[0]?.currency ?? target?.currency ?? "EUR";

  const yearTotal = data.length > 0
    ? statuses.reduce((sum, s) => sum + ((data[data.length - 1][s.key] as number) || 0), 0)
    : 0;

  const hasData = contributors.length > 0;
  const hasTarget = target && target.amount > 0;
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

  return (
    <div className="mt-2 rounded-md border bg-card p-2">
      <div className="flex items-center justify-between mb-2 gap-2 flex-wrap">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cumulative {metric === "both" ? "Savings + Income" : metric === "savings" ? "Savings" : "Income"} · {year}
          </h4>
          <p className="text-[10px] text-muted-foreground">
            Sliced by current status · {currency}{" "}
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
                  {metric === "savings" ? "Savings" : "Income"} target · {year}
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
                statuses.find((s) => s.key === name)?.label ?? name,
              ]}
            />
            <Legend wrapperStyle={{ fontSize: 10 }} iconSize={8} />
            {statuses.map((s) => (
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
