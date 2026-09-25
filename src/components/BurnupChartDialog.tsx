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
import { backlogPoints, burnupTargets, childrenInTree } from "@/lib/backlogPoints";
import { effectivePointsInScope, extendToDate, statusBreakdown } from "@/lib/burnupMath";
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
import { getEffectiveParentId, type WorkItem } from "@/types/models";

export interface BurnupScope {
  kind: ChartScopeKind;
  id: string;
  name: string;
  /** For a work item, the tree it was opened in: an item's children depend on
   *  the tree, since one can have a different parent in each. */
  treeId?: string;
}

/** The tree a scope is seen in: its own, its backlog's, or the one it was opened in. */
function scopeTreeId(scope: BurnupScope, backlogs: Record<string, { treeId: string }>): string | undefined {
  if (scope.kind === "tree") return scope.id;
  if (scope.kind === "backlog") return backlogs[scope.id]?.treeId;
  return scope.treeId;
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
    childrenInTree(workItems, id, scope.treeId).forEach((c) => addAllUnderItem(c, out));
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
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const chartPrefs = useChartPrefsStore((s) => s.prefs);
  const setMetric = useChartPrefsStore((s) => s.setMetric);

  const [rows, setRows] = useState<HistoryRow[] | null>(null);
  const [loading, setLoading] = useState(false);

  const itemIds = useMemo(() => (scope && open ? collectScopeItemIds(scope) : []), [scope, open, workItems]);

  // Any item in scope has points → default to points, else count.
  const anyHasPoints = useMemo(
    () => itemIds.some((id) => (workItems[id]?.points ?? 0) > 0),
    [itemIds, workItems],
  );

  const storedMetric = scope ? chartPrefs[`${scope.kind}:${scope.id}`] : undefined;
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
  const treeId = useMemo(() => (scope ? scopeTreeId(scope, backlogs) : undefined), [scope, backlogs]);

  // Top-level items within the scope: used to sum up the branch's total. The
  // parent is the one this tree gives an item, as everywhere below.
  const scopeRoots = useMemo(
    () =>
      itemIds.filter((id) => {
        const wi = workItems[id];
        if (!wi) return true;
        const parentId = treeId ? getEffectiveParentId(wi, treeId) : wi.parentId;
        return parentId == null || !scopeSet.has(parentId);
      }),
    [itemIds, scopeSet, workItems, treeId],
  );

  // The items' total: branch total for points, item count for count.
  const itemsTotal = useMemo(() => {
    if (metric === "count") return itemIds.length;
    const memo = new Map<string, number>();
    return scopeRoots.reduce(
      (sum, id) => sum + effectivePointsInScope(workItems, id, scopeSet, memo, treeId),
      0,
    );
  }, [metric, itemIds, scopeRoots, scopeSet, workItems, treeId]);

  // What estimates on backlogs add: the backlog's own points, and for a backlog
  // or a tree the excess of estimates below over their own items.
  const estimate = useMemo((): { own?: number; upliftBelow: number } => {
    if (!scope || metric === "count") return { upliftBelow: 0 };
    if (scope.kind === "backlog") {
      const bl = backlogs[scope.id];
      if (!bl) return { upliftBelow: 0 };
      const bp = backlogPoints(scope.id, bl.treeId, workItems, backlogs);
      return { own: bp.own, upliftBelow: bp.contents - bp.itemsTotal };
    }
    if (scope.kind === "tree") {
      const tree = backlogTrees[scope.id];
      if (!tree) return { upliftBelow: 0 };
      const memo = new Map<string, number>();
      const uplift = tree.rootBacklogIds.reduce((sum, id) => {
        const bp = backlogPoints(id, scope.id, workItems, backlogs, memo);
        return sum + (bp.effective - bp.itemsTotal);
      }, 0);
      return { upliftBelow: uplift };
    }
    return { upliftBelow: 0 };
  }, [scope, metric, backlogs, backlogTrees, workItems]);

  const targets = useMemo(
    () => burnupTargets({ metric, itemsTotal, ...estimate }),
    [metric, itemsTotal, estimate],
  );
  const total = targets.target;
  const chartTop = Math.max(targets.target, targets.scopeLine?.value ?? 0, targets.projectTo);

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
            treeId,
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
  }, [rows, statusPalette, metric, itemIds, scopeRoots, scopeSet, workItems, treeId]);

  // Projected completion: a dashed red line from today's completed amount to
  // the target, extrapolating the completion rate observed so far.
  const projection = useMemo(() => {
    const data = chartData.data;
    if (!data || data.length === 0 || targets.projectTo <= 0) return null;
    const last = data[data.length - 1];
    const doneNow = (last.done as number) ?? 0;
    if (doneNow <= 0 || doneNow >= targets.projectTo) return null;

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

    const remaining = targets.projectTo - doneNow;
    const daysToGo = Math.max(1, Math.ceil(remaining / rate));
    const endDate = new Date(today.getTime() + daysToGo * 86400000);

    return {
      start: { x: today.toISOString().slice(0, 10), y: doneNow },
      end: { x: endDate.toISOString().slice(0, 10), y: targets.projectTo },
      endStr: endDate.toISOString().slice(0, 10),
    };
  }, [chartData, targets.projectTo]);

  // Extend the series out to the projection end date so the dashed line's
  // endpoint lands on a real x-axis category.
  const chartRows = useMemo(
    () => (projection ? extendToDate(chartData.data, projection.endStr) : chartData.data),
    [projection, chartData],
  );

  const yDomain: [number | string, number | string] =
    chartTop > 0 ? [0, chartTop] : [0, "auto"];

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
                {/* What the contents add up to, beside an estimate that differs. */}
                {targets.scopeLine && targets.scopeLine.value > 0 && (
                  <ReferenceLine
                    y={targets.scopeLine.value}
                    stroke="#64748b"
                    strokeDasharray="3 3"
                    strokeWidth={1.25}
                    label={{
                      value: targets.scopeLine.label,
                      position: "insideBottomRight",
                      fill: "#64748b",
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
