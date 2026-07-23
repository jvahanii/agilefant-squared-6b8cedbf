import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { supabase } from "@/integrations/supabase/client";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useAuth } from "@/hooks/useAuth";
import {
  useChartPrefsStore,
  type ChartMetric,
  type ChartScopeKind,
} from "@/store/chartPrefsStore";
import { getEffectiveStatuses, DEFAULT_STATUSES } from "@/store/backlogStatusesStore";
import { paginateSelect } from "@/integrations/supabase/pagination";
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

export interface BurnupScope {
  kind: ChartScopeKind;
  id: string;
  name: string;
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  scope: BurnupScope | null;
}

interface HistoryRow {
  work_item_id: string;
  event: string;
  existed: boolean;
  status: string | null;
  points: number | null;
  snapshot_at: string;
}

/** Collect all descendant work item ids that belong to the given scope. */
function collectScopeItemIds(scope: BurnupScope): string[] {
  const state = useAppStore.getState();
  const { workItems, backlogs, backlogTrees } = state;

  const addAllUnderItem = (id: string, out: Set<string>) => {
    if (out.has(id)) return;
    const wi = workItems[id];
    if (!wi) return;
    out.add(id);
    wi.childrenIds.forEach((c) => addAllUnderItem(c, out));
  };

  const collectBacklogIds = (rootId: string): string[] => {
    const out: string[] = [];
    const walk = (id: string) => {
      const bl = backlogs[id];
      if (!bl) return;
      out.push(id);
      bl.childrenIds.forEach(walk);
    };
    walk(rootId);
    return out;
  };

  const out = new Set<string>();

  if (scope.kind === "work_item") {
    addAllUnderItem(scope.id, out);
  } else if (scope.kind === "backlog") {
    const backlogIds = new Set(collectBacklogIds(scope.id));
    for (const wi of Object.values(workItems)) {
      for (const bid of Object.values(wi.backlogAssignments)) {
        if (backlogIds.has(bid)) {
          out.add(wi.id);
          break;
        }
      }
    }
  } else {
    // tree
    const tree = backlogTrees[scope.id];
    if (!tree) return [];
    for (const wi of Object.values(workItems)) {
      if (wi.backlogAssignments[scope.id]) out.add(wi.id);
    }
  }
  return Array.from(out);
}

function ymd(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function eachDay(start: Date, end: Date): string[] {
  const out: string[] = [];
  const cur = new Date(start);
  cur.setUTCHours(0, 0, 0, 0);
  const stop = new Date(end);
  stop.setUTCHours(0, 0, 0, 0);
  while (cur.getTime() <= stop.getTime()) {
    out.push(ymd(cur));
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return out;
}

export function BurnupChartDialog({ open, onOpenChange, scope }: Props) {
  const { user } = useAuth();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const workItems = useAppStore((s) => s.workItems);
  const getMetric = useChartPrefsStore((s) => s.getMetric);
  const setMetric = useChartPrefsStore((s) => s.setMetric);

  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const itemIds = useMemo(() => (scope && open ? collectScopeItemIds(scope) : []), [scope, open, workItems]);

  // Any item in scope has points → default to points, else count.
  const anyHasPoints = useMemo(
    () => itemIds.some((id) => (workItems[id]?.points ?? 0) > 0),
    [itemIds, workItems],
  );

  const storedMetric = scope ? getMetric(scope.kind, scope.id) : undefined;
  const metric: ChartMetric = storedMetric ?? (anyHasPoints ? "points" : "count");

  // Determine status palette from the first item's backlog (fallback = defaults).
  const statusPalette = useMemo(() => {
    if (!scope) return DEFAULT_STATUSES;
    if (scope.kind === "backlog") return getEffectiveStatuses(scope.id);
    // For tree / work_item: pick any backlog assignment of the first item under scope.
    for (const id of itemIds) {
      const wi = workItems[id];
      if (!wi) continue;
      const backlogId = scope.kind === "tree"
        ? wi.backlogAssignments[scope.id]
        : Object.values(wi.backlogAssignments)[0];
      if (backlogId) return getEffectiveStatuses(backlogId);
    }
    return DEFAULT_STATUSES;
  }, [scope, itemIds, workItems]);

  useEffect(() => {
    if (!open || !scope || itemIds.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const data = await paginateSelect(
        (from, to) =>
          (supabase as any)
            .from("work_item_history")
            .select("work_item_id, event, existed, status, points, snapshot_at")
            .in("work_item_id", itemIds)
            .order("snapshot_at", { ascending: true })
            .range(from, to),
        1000,
      );
      if (!cancelled) {
        setRows((data as HistoryRow[]) ?? []);
        setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [open, scope, itemIds]);

  const chartData = useMemo(() => {
    if (!rows || rows.length === 0) return { data: [], keys: [] as string[] };

    // Group events by item, sorted by time
    const perItem = new Map<string, HistoryRow[]>();
    for (const r of rows) {
      const list = perItem.get(r.work_item_id) ?? [];
      list.push(r);
      perItem.set(r.work_item_id, list);
    }

    const minTs = rows[0].snapshot_at;
    const start = new Date(minTs);
    const end = new Date();
    const days = eachDay(start, end);

    const statusKeys = statusPalette.map((s) => s.key);

    const data = days.map((day) => {
      const dayEnd = new Date(day + "T23:59:59.999Z").getTime();
      const bucket: Record<string, number> = { date: 0 as unknown as number };
      const out: Record<string, number | string> = { date: day };
      for (const key of statusKeys) out[key] = 0;

      for (const [_id, events] of perItem) {
        // Find latest event <= dayEnd
        let latest: HistoryRow | undefined;
        for (const e of events) {
          if (new Date(e.snapshot_at).getTime() <= dayEnd) latest = e;
          else break;
        }
        if (!latest || !latest.existed) continue;
        const statusKey = latest.status ?? "not_started";
        if (!statusKeys.includes(statusKey)) continue;
        const contribution =
          metric === "points" ? (latest.points ?? 1) : 1;
        out[statusKey] = ((out[statusKey] as number) ?? 0) + contribution;
      }
      return out;
    });

    return { data, keys: statusKeys };
  }, [rows, statusPalette, metric]);

  const handleMetricChange = async (m: ChartMetric) => {
    if (!scope || !user || !activeOrgId) return;
    await setMetric(user.id, activeOrgId, scope.kind, scope.id, m);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl">
        <DialogHeader>
          <DialogTitle>Burnup — {scope?.name ?? ""}</DialogTitle>
          <DialogDescription>
            Cumulative status flow over time.
          </DialogDescription>
        </DialogHeader>

        <div className="flex items-center gap-4">
          <Label className="text-xs text-muted-foreground">Metric:</Label>
          <RadioGroup
            value={metric}
            onValueChange={(v) => handleMetricChange(v as ChartMetric)}
            className="flex gap-4"
          >
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="count" id="metric-count" />
              <Label htmlFor="metric-count" className="text-xs">Item count</Label>
            </div>
            <div className="flex items-center gap-1.5">
              <RadioGroupItem value="points" id="metric-points" />
              <Label htmlFor="metric-points" className="text-xs">Points</Label>
            </div>
          </RadioGroup>
        </div>

        <div className="h-[420px] w-full">
          {loading ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              Loading history…
            </div>
          ) : chartData.data.length === 0 ? (
            <div className="h-full flex items-center justify-center text-sm text-muted-foreground">
              No history yet. Changes going forward will populate this chart.
            </div>
          ) : (
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={chartData.data as any[]} margin={{ top: 8, right: 16, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} />
                <RechartsTooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {chartData.keys.map((key) => {
                  const s = statusPalette.find((x) => x.key === key);
                  return (
                    <Area
                      key={key}
                      type="monotone"
                      dataKey={key}
                      stackId="1"
                      name={s?.label ?? key}
                      stroke={s?.color ?? "#94a3b8"}
                      fill={s?.color ?? "#94a3b8"}
                      fillOpacity={0.75}
                    />
                  );
                })}
              </AreaChart>
            </ResponsiveContainer>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
