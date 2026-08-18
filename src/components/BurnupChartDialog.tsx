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
  ReferenceLine,
  ResponsiveContainer,
} from "recharts";
import type { WorkItem } from "@/types/models";

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

/** Effective points of a (sub)branch: max(own points, sum of in-scope children). */
function effectivePointsInScope(
  workItems: Record<string, WorkItem>,
  id: string,
  scopeSet: Set<string>,
  memo: Map<string, number>,
): number {
  const cached = memo.get(id);
  if (cached !== undefined) return cached;
  const wi = workItems[id];
  if (!wi) {
    memo.set(id, 0);
    return 0;
  }
  const own = wi.points ?? 0;
  let childSum = 0;
  for (const cid of wi.childrenIds) {
    if (!scopeSet.has(cid)) continue;
    childSum += effectivePointsInScope(workItems, cid, scopeSet, memo);
  }
  const total = Math.max(own, childSum);
  memo.set(id, total);
  return total;
}

/**
 * Distributes a branch's effective points across status buckets for a single
 * day. A rolled-up parent (its own points >= children sum) contributes the
 * leftover to its own status; when the parent is "done", the whole branch is
 * credited as done. This mirrors the list-view effective/completed points so
 * parent points never double-count their children.
 */
function statusBreakdown(
  workItems: Record<string, WorkItem>,
  id: string,
  scopeSet: Set<string>,
  dayState: Map<string, { status: string; points: number }>,
  statusKeys: string[],
  seen: Set<string>,
): Record<string, number> {
  if (seen.has(id)) return {};
  seen.add(id);
  const wi = workItems[id];
  if (!wi) return {};

  const live = dayState.get(id);
  let status = live?.status ?? wi.status;
  if (!statusKeys.includes(status)) status = "not_started";
  const ownPoints = live ? (live.points ?? 0) : (wi.points ?? 0);

  if (wi.childrenIds.length === 0) {
    return { [status]: ownPoints };
  }

  const childBreak: Record<string, number> = {};
  for (const cid of wi.childrenIds) {
    if (!scopeSet.has(cid)) continue;
    const sub = statusBreakdown(workItems, cid, scopeSet, dayState, statusKeys, seen);
    for (const [k, v] of Object.entries(sub)) {
      childBreak[k] = (childBreak[k] ?? 0) + v;
    }
  }
  const childSum = Object.values(childBreak).reduce((a, b) => a + b, 0);

  if (status === "done") {
    return { done: Math.max(ownPoints, childSum) };
  }

  const leftover = Math.max(0, ownPoints - childSum);
  if (leftover > 0) {
    childBreak[status] = (childBreak[status] ?? 0) + leftover;
  }
  return childBreak;
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

  const statusKeys = useMemo(() => statusPalette.map((s) => s.key), [statusPalette]);

  // Stacking order (bottom → top) for the cumulative chart: "done" sits at the
  // bottom, "not_started" at the top, and every other status stacks in the same
  // order its board column appears left-to-right. Recharts stacks in render
  // order (first <Area> = bottom), so this list drives the render order.
  const stackKeys = useMemo(() => {
    const board = statusPalette.map((s) => s.key);
    const done = board.filter((k) => k === "done");
    const middle = board.filter((k) => k !== "done" && k !== "not_started");
    const notStarted = board.filter((k) => k === "not_started");
    return [...done, ...middle, ...notStarted];
  }, [statusPalette]);

  const scopeSet = useMemo(() => new Set(itemIds), [itemIds]);

  // Top-level items within the scope: used to sum up the branch's total.
  const scopeRoots = useMemo(
    () =>
      itemIds.filter((id) => {
        const wi = workItems[id];
        return !wi || wi.parentId == null || !scopeSet.has(wi.parentId);
      }),
    [itemIds, scopeSet, workItems],
  );

  // The vertical scale target: branch total for points, item count for count.
  const total = useMemo(() => {
    if (metric === "count") return itemIds.length;
    const memo = new Map<string, number>();
    return scopeRoots.reduce(
      (sum, id) => sum + effectivePointsInScope(workItems, id, scopeSet, memo),
      0,
    );
  }, [metric, itemIds, scopeRoots, scopeSet, workItems]);

  useEffect(() => {
    if (!open || !scope || itemIds.length === 0) {
      setRows([]);
      return;
    }
    let cancelled = false;
    setLoading(true);
    (async () => {
      const { data } = await paginateSelect<HistoryRow>(
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
        setRows(data ?? []);
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

    const keys = statusPalette.map((s) => s.key);

    const data = days.map((day) => {
      const dayEnd = new Date(day + "T23:59:59.999Z").getTime();
      const out: Record<string, number | string> = { date: day };
      for (const key of keys) out[key] = 0;

      if (metric === "points") {
        // Resolve each item's status/points as of this day, then decompose the
        // branch so rolled-up parents do not double-count their children.
        const dayState = new Map<string, { status: string; points: number }>();
        for (const id of itemIds) {
          const events = perItem.get(id);
          if (events) {
            let latest: HistoryRow | undefined;
            for (const e of events) {
              if (new Date(e.snapshot_at).getTime() <= dayEnd) latest = e;
              else break;
            }
            if (!latest || !latest.existed) continue;
            dayState.set(id, { status: latest.status ?? "not_started", points: latest.points ?? 0 });
          } else {
            // No history yet — fall back to the item's current state.
            const wi = workItems[id];
            if (wi) dayState.set(id, { status: wi.status, points: wi.points ?? 0 });
          }
        }

        for (const rootId of scopeRoots) {
          const breakdown = statusBreakdown(
            workItems,
            rootId,
            scopeSet,
            dayState,
            keys,
            new Set<string>(),
          );
          for (const [k, v] of Object.entries(breakdown)) {
            out[k] = ((out[k] as number) ?? 0) + v;
          }
        }
      } else {
        // Count metric: one unit per in-scope item, in its status.
        for (const id of itemIds) {
          const events = perItem.get(id);
          let latest: HistoryRow | undefined;
          if (events) {
            for (const e of events) {
              if (new Date(e.snapshot_at).getTime() <= dayEnd) latest = e;
              else break;
            }
            if (!latest || !latest.existed) continue;
          } else {
            const wi = workItems[id];
            if (!wi) continue;
            latest = { work_item_id: id, event: "", existed: true, status: wi.status, points: wi.points ?? 0, snapshot_at: day } as HistoryRow;
          }
          const statusKey = latest.status ?? "not_started";
          if (!keys.includes(statusKey)) continue;
          out[statusKey] = ((out[statusKey] as number) ?? 0) + 1;
        }
      }
      return out;
    });

    return { data, keys };
  }, [rows, statusPalette, metric, itemIds, scopeRoots, scopeSet, workItems]);

  // Projected completion: a dashed red line from today's completed amount to
  // the target, extrapolating the completion rate observed so far.
  const projection = useMemo(() => {
    const data = chartData.data;
    if (!data || data.length === 0 || total <= 0) return null;
    const last = data[data.length - 1];
    const doneNow = (last.done as number) ?? 0;
    if (doneNow <= 0 || doneNow >= total) return null;

    let firstDoneIdx = -1;
    for (let i = 0; i < data.length; i++) {
      if (((data[i].done as number) ?? 0) > 0) {
        firstDoneIdx = i;
        break;
      }
    }
    if (firstDoneIdx < 0) return null;

    const today = new Date();
    today.setUTCHours(0, 0, 0, 0);
    const firstDate = new Date((data[firstDoneIdx].date as string) + "T00:00:00Z");
    const daysElapsed = Math.max(1, Math.round((today.getTime() - firstDate.getTime()) / 86400000));
    const rate = doneNow / daysElapsed;
    if (!(rate > 0)) return null;

    const remaining = total - doneNow;
    const daysToGo = Math.max(1, Math.ceil(remaining / rate));
    const endDate = new Date(today.getTime() + daysToGo * 86400000);

    return {
      start: { x: today.toISOString().slice(0, 10), y: doneNow },
      end: { x: endDate.toISOString().slice(0, 10), y: total },
      endStr: endDate.toISOString().slice(0, 10),
    };
  }, [chartData, total]);

  // Extend the series out to the projection end date so the dashed line's
  // endpoint lands on a real x-axis category.
  const chartRows = useMemo(() => {
    if (!projection || chartData.data.length === 0) return chartData.data;
    const last = chartData.data[chartData.data.length - 1];
    const lastTime = new Date((last.date as string) + "T00:00:00Z").getTime();
    const endTime = new Date(projection.endStr + "T00:00:00Z").getTime();
    if (endTime <= lastTime) return chartData.data;
    const out = [...chartData.data];
    const cursor = new Date(lastTime);
    while (true) {
      cursor.setUTCDate(cursor.getUTCDate() + 1);
      if (cursor.getTime() > endTime) break;
      out.push({ ...last, date: cursor.toISOString().slice(0, 10) });
    }
    return out;
  }, [projection, chartData]);

  const yDomain: [number | string, number | string] =
    total > 0 ? [0, total] : [0, "auto"];

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
              <AreaChart data={chartRows as any[]} margin={{ top: 8, right: 24, left: 0, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" opacity={0.3} />
                <XAxis dataKey="date" tick={{ fontSize: 10 }} />
                <YAxis tick={{ fontSize: 10 }} domain={yDomain} />
                <RechartsTooltip />
                <Legend wrapperStyle={{ fontSize: 11 }} />
                {total > 0 && (
                  <ReferenceLine
                    y={total}
                    stroke="#ef4444"
                    strokeWidth={1.5}
                    label={{
                      value: `Target ${total}`,
                      position: "insideTopRight",
                      fill: "#ef4444",
                      fontSize: 10,
                    }}
                  />
                )}
                {projection && (
                  <ReferenceLine
                    segment={[
                      { x: projection.start.x, y: projection.start.y },
                      { x: projection.end.x, y: projection.end.y },
                    ]}
                    stroke="#ef4444"
                    strokeDasharray="6 4"
                    strokeWidth={1.5}
                  />
                )}
                {stackKeys.map((key) => {
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
