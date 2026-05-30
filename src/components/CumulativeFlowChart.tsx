import { useMemo, useState } from "react";
import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip as RechartsTooltip,
  Legend,
  ResponsiveContainer,
} from "recharts";
import { Button } from "@/components/ui/button";
import { useAppStore } from "@/store/appStore";
import { useFinancialsStore, type MonthlyMap } from "@/store/financialsStore";
import { useTreeStatusesStore, DEFAULT_TREE_STATUSES } from "@/store/treeStatusesStore";

type Metric = "savings" | "income";

interface Props {
  treeId: string;
}

function addMonths(d: Date, n: number): Date {
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + n, 1));
}

function formatMonthLabel(key: string): string {
  const [y, m] = key.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, 1)).toLocaleString(undefined, {
    month: "short",
    year: "2-digit",
  });
}

function monthKey(d: Date): string {
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
}

export function CumulativeFlowChart({ treeId }: Props) {
  const [metric, setMetric] = useState<Metric>("savings");
  const workItems = useAppStore((s) => s.workItems);
  const byWorkItem = useFinancialsStore((s) => s.byWorkItem);
  const statusesList = useTreeStatusesStore((s) => s.statusesByTree[treeId]);

  const statuses = useMemo(() => {
    const list = statusesList && statusesList.length > 0 ? statusesList : DEFAULT_TREE_STATUSES;
    return [...list]
      .sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0))
      .map((s) => ({ key: s.key, label: s.label, color: s.color }));
  }, [statusesList]);

  // Items in this tree with non-empty monthly entries for the selected metric,
  // grouped by current status.
  const contributors = useMemo(() => {
    const out: Array<{ status: string; entries: MonthlyMap; currency: string }> = [];
    for (const id of Object.keys(byWorkItem)) {
      const wi = workItems[id];
      if (!wi) continue;
      if (!(treeId in wi.backlogAssignments)) continue;
      const e = byWorkItem[id];
      const map = metric === "savings" ? e.savingsByMonth : e.incomeByMonth;
      if (!map || Object.keys(map).length === 0) continue;
      out.push({ status: wi.status, entries: map, currency: e.currency });
    }
    return out;
  }, [byWorkItem, workItems, treeId, metric]);

  const data = useMemo(() => {
    if (contributors.length === 0) return [];
    // Range = earliest entry month → current month.
    let firstKey: string | null = null;
    for (const c of contributors) {
      for (const k of Object.keys(c.entries)) {
        if (firstKey === null || k < firstKey) firstKey = k;
      }
    }
    if (!firstKey) return [];
    const [fy, fm] = firstKey.split("-").map(Number);
    const start = new Date(Date.UTC(fy, fm - 1, 1));
    const now = new Date();
    const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const months: string[] = [];
    let cursor = start;
    while (cursor <= end) {
      months.push(monthKey(cursor));
      cursor = addMonths(cursor, 1);
      if (months.length > 600) break;
    }
    return months.map((mk) => {
      const row: Record<string, number | string> = { month: mk };
      for (const s of statuses) row[s.key] = 0;
      for (const c of contributors) {
        let accrued = 0;
        for (const [k, v] of Object.entries(c.entries)) {
          if (k <= mk) accrued += v;
        }
        if (accrued > 0) {
          row[c.status] = (row[c.status] as number) + accrued;
        }
      }
      return row;
    });
  }, [contributors, statuses]);

  const currency = contributors[0]?.currency ?? "EUR";

  if (contributors.length === 0) return null;

  const total = data.length > 0
    ? statuses.reduce((sum, s) => sum + ((data[data.length - 1][s.key] as number) || 0), 0)
    : 0;

  return (
    <div className="mt-2 rounded-md border bg-card p-2">
      <div className="flex items-center justify-between mb-2">
        <div>
          <h4 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
            Cumulative {metric === "savings" ? "Savings" : "Income"}
          </h4>
          <p className="text-[10px] text-muted-foreground">
            Sliced by current status · {currency}{" "}
            {total.toLocaleString(undefined, { maximumFractionDigits: 0 })}
          </p>
        </div>
        <div className="flex gap-1">
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
      </div>
      <div className="h-44 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart data={data} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" className="stroke-border/40" />
            <XAxis
              dataKey="month"
              tickFormatter={formatMonthLabel}
              tick={{ fontSize: 10 }}
              minTickGap={20}
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
              labelFormatter={(l: string) => formatMonthLabel(l)}
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
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
