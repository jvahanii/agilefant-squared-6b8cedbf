import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { ZoomIn, ZoomOut } from "lucide-react";
import { IconizedTitle } from "@/components/IconizedTitle";
import { StartEndDatesDialog } from "@/components/StartEndDatesDialog";
import { useIsMobile } from "@/hooks/use-mobile";
import { scrambleName } from "@/lib/scramble";
import {
  barFor,
  barPixels,
  dayIso,
  dayWidth,
  dragDates,
  isWeekend,
  monthTicks,
  timelineRange,
  todayNumber,
  weekStarts,
  validZoom,
  zoomStep,
  type DragMode,
  type TimelineBar,
} from "@/lib/timeline";
import { buildVisibleRows } from "@/lib/workItemRows";
import { describeStartEnd, formatStartEnd } from "@/lib/workItemStartEnd";
import { useAppStore } from "@/store/appStore";
import { getEffectiveStatuses, useBacklogStatusesStore } from "@/store/backlogStatusesStore";
import { visibleWorkItemIdsRef } from "@/store/navigationRefs";
import { getEffectiveParentId, type WorkItem } from "@/types/models";

interface TimelineViewProps {
  treeId: string;
  /** The list's top-level rows, in the order the list shows them. */
  rootIds: string[];
  /** The lists in view: the selected one and those beneath it. */
  backlogIds: ReadonlySet<string>;
  /** Titles are shown scrambled, as the list shows them. */
  isScrambled: boolean;
}

const ROW_HEIGHT = 28;
/** Where the zoom chosen is kept, so it is still there on the next visit. */
const ZOOM_KEY = "timeline-day-width-v1";
const storedZoom = (): number | null => {
  try {
    return validZoom(localStorage.getItem(ZOOM_KEY));
  } catch {
    return null;
  }
};
/** Every branch open: a timeline has no rows to fold. */
const ALL_EXPANDED = { has: () => true } as unknown as ReadonlySet<string>;

/**
 * A list's work items against a calendar: one row each, in the list's own
 * order and nesting, with a bar from the day its work started to the day it
 * ended.
 *
 * Work that has started and not ended runs to today and fades out; an end
 * with no recorded start is a diamond on its day. Rows with neither date show
 * no bar — and can be left out altogether, which is how the view starts once
 * any row has a date, since a list is usually mostly undated.
 *
 * Clicking a row selects it, as in the list, so the keyboard works the same;
 * clicking its bar (or, on an undated row, the track) sets its dates. A bar
 * can also be dragged: by its middle to move the work in time, by an end to
 * make it longer or shorter. The dates follow the pointer a day at a time and
 * are saved when it is let go — one step to undo.
 *
 * The scale is chosen from the span of the dates — days readable for a few
 * weeks, squeezed for years — until the reader zooms in or out, which is then
 * kept for every list until they hand the choice back.
 */
export function TimelineView({ treeId, rootIds, backlogIds, isScrambled }: TimelineViewProps) {
  const workItems = useAppStore((s) => s.workItems);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  // Bars take their item's status colour; subscribed so a status edit repaints.
  const statusesByBacklog = useBacklogStatusesStore((s) => s.statusesByBacklog);
  const isMobile = useIsMobile();
  const [editing, setEditing] = useState<string | null>(null);
  // The bar being dragged, and how many days the pointer has carried it. The
  // store is not touched until the drag ends; the row draws from this.
  const [drag, setDrag] = useState<{ id: string; mode: DragMode; days: number } | null>(null);
  const dragStart = useRef<{ id: string; mode: DragMode; x: number } | null>(null);
  // Letting go after a drag also counts as a click on the bar; it must not
  // open the dates dialog on top of the change just made.
  const justDragged = useRef(false);
  // Null until the reader chooses: with dates only once anything has one.
  const [datedOnlyChoice, setDatedOnlyChoice] = useState<boolean | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  const allRows = useMemo(
    () => buildVisibleRows(rootIds, ALL_EXPANDED, workItems, treeId, backlogIds),
    [rootIds, workItems, treeId, backlogIds],
  );
  const hasDates = (item: WorkItem | undefined) => !!(item?.startedOn || item?.endedOn);
  const anyDated = useMemo(() => allRows.ids.some((id) => hasDates(workItems[id])), [allRows, workItems]);
  const datedOnly = datedOnlyChoice ?? anyDated;

  // With dates only: the dated rows, and the rows above them that say where
  // they belong. A dated child shown without its parent would have lost its place.
  const rowIds = useMemo(() => {
    if (!datedOnly) return allRows.ids;
    const keep = new Set<string>();
    for (const id of allRows.ids) {
      if (!hasDates(workItems[id])) continue;
      let current: string | null = id;
      while (current && !keep.has(current) && allRows.depths.has(current)) {
        keep.add(current);
        const item = workItems[current];
        current = item ? getEffectiveParentId(item, treeId) : null;
      }
    }
    return allRows.ids.filter((id) => keep.has(id));
  }, [allRows, datedOnly, workItems, treeId]);

  const today = todayNumber();
  const range = useMemo(
    () => timelineRange(rowIds.map((id) => workItems[id]).filter(Boolean), today),
    [rowIds, workItems, today],
  );
  // Where the calendar was scrolled to, as the reader left it. Not read off
  // the element once the scale has changed: a calendar that has just got
  // narrower has already been pulled back to its new end by then, and the
  // middle worked out from that is the wrong day. Kept by the scroll itself,
  // and taken again just before a change made here, since a scroll is only
  // reported once the browser gets round to drawing it.
  const scrolledTo = useRef(0);
  const noteScroll = () => {
    if (scrollRef.current) scrolledTo.current = scrollRef.current.scrollLeft;
  };
  // Null while the scale is left to the span of the dates.
  const [zoom, setZoom] = useState<number | null>(storedZoom);
  const width = zoom ?? dayWidth(range);
  const chooseZoom = (next: number | null) => {
    noteScroll();
    setZoom(next);
    try {
      if (next === null) localStorage.removeItem(ZOOM_KEY);
      else localStorage.setItem(ZOOM_KEY, String(next));
    } catch {
      /* not kept; the view still zooms */
    }
  };
  const zoomIn = zoomStep(width, 1);
  const zoomOut = zoomStep(width, -1);
  const totalDays = range.end - range.start + 1;
  const trackWidth = totalDays * width;
  const leftWidth = isMobile ? 150 : 280;
  const months = useMemo(() => monthTicks(range), [range]);
  const weeks = useMemo(() => weekStarts(range), [range]);
  const todayLeft = (today - range.start) * width;

  // The arrow keys walk these rows, in this order, as they walk the list's.
  useEffect(() => {
    visibleWorkItemIdsRef.current = rowIds;
  }, [rowIds]);

  // Open on today, a little in from the left edge, rather than on whatever day
  // the span happens to begin with. After that the calendar stays put: when a
  // change of dates stretches the span, or the scale changes — by itself or by
  // zooming — the day in the middle of the screen is kept there, so a bar just
  // dragged does not jump away and zooming closes in on what was being looked at.
  const drawn = useRef<{ start: number; width: number } | null>(null);
  useLayoutEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    const before = drawn.current;
    drawn.current = { start: range.start, width };
    if (!before) {
      el.scrollLeft = Math.max(0, todayLeft - (el.clientWidth - leftWidth) / 3);
    } else if (before.start !== range.start || before.width !== width) {
      const half = Math.max(0, el.clientWidth - leftWidth) / 2;
      const middleDay = before.start + (scrolledTo.current + half) / before.width;
      el.scrollLeft = Math.max(0, (middleDay - range.start) * width - half);
    }
    scrolledTo.current = el.scrollLeft;
  }, [range.start, width, todayLeft, leftWidth]);

  const daysCarried = (clientX: number) =>
    dragStart.current ? Math.round((clientX - dragStart.current.x) / width) : 0;
  const beginDrag = (id: string, mode: DragMode, e: React.PointerEvent) => {
    if (e.button !== 0) return;
    e.stopPropagation();
    // Capture keeps the drag going when the pointer leaves the bar. A browser
    // may refuse it — the pointer already gone, say — and the drag then simply
    // ends where the pointer leaves, which is no reason not to start it.
    try {
      (e.currentTarget as HTMLElement).setPointerCapture?.(e.pointerId);
    } catch {
      /* dragging without capture */
    }
    dragStart.current = { id, mode, x: e.clientX };
    setDrag({ id, mode, days: 0 });
  };
  const moveDrag = (e: React.PointerEvent) => {
    if (!dragStart.current) return;
    const days = daysCarried(e.clientX);
    setDrag((current) => (current && current.days !== days ? { ...current, days } : current));
  };
  const endDrag = (e: React.PointerEvent) => {
    const started = dragStart.current;
    if (!started) return;
    const days = daysCarried(e.clientX);
    dragStart.current = null;
    setDrag(null);
    const item = useAppStore.getState().workItems[started.id];
    const change = item ? dragDates(item, started.mode, days, today) : {};
    if (Object.keys(change).length === 0) return;
    justDragged.current = true;
    noteScroll();
    // The click that follows a release arrives at once; if none does — the
    // pointer was let go somewhere else — the next real click must still work.
    window.setTimeout(() => {
      justDragged.current = false;
    }, 100);
    useAppStore.getState().setWorkItemStartEnd(started.id, change);
  };
  const cancelDrag = () => {
    dragStart.current = null;
    setDrag(null);
  };

  // Keyboard selection moving out of sight brings its row back into view.
  useEffect(() => {
    const reveal = (e: Event) => {
      const id = (e as CustomEvent<{ id: string }>).detail?.id;
      if (!id) return;
      scrollRef.current
        ?.querySelector(`[data-timeline-row="${CSS.escape(id)}"]`)
        ?.scrollIntoView?.({ block: "nearest", inline: "nearest" });
    };
    window.addEventListener("shortcut:reveal-work-item", reveal);
    return () => window.removeEventListener("shortcut:reveal-work-item", reveal);
  }, []);

  const statusColor = (item: WorkItem): string => {
    void statusesByBacklog;
    const statuses = getEffectiveStatuses(item.backlogAssignments[treeId]);
    return statuses.find((s) => s.key === item.status)?.color ?? "hsl(var(--primary))";
  };

  return (
    <div
      ref={scrollRef}
      className="flex-1 overflow-auto"
      role="region"
      aria-label="Timeline"
      onScroll={noteScroll}
      onClick={(e) => e.stopPropagation()}
    >
      <div className="relative" style={{ width: leftWidth + trackWidth, minWidth: "100%" }}>
        {/* The axis, stuck to the top; its corner cell stuck to the left too. */}
        <div className="sticky top-0 z-20 flex h-12 border-b bg-background">
          <div
            className="sticky left-0 z-30 flex shrink-0 flex-col justify-between border-r bg-background px-2 pb-1.5 pt-1"
            style={{ width: leftWidth }}
          >
            <div className="flex items-center gap-0.5 text-muted-foreground" role="group" aria-label="Zoom">
              <button
                type="button"
                onClick={() => zoomOut !== null && chooseZoom(zoomOut)}
                disabled={zoomOut === null}
                aria-label="Zoom out"
                title="Zoom out: more time on the screen"
                className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <ZoomOut className="h-3.5 w-3.5" />
              </button>
              <button
                type="button"
                onClick={() => zoomIn !== null && chooseZoom(zoomIn)}
                disabled={zoomIn === null}
                aria-label="Zoom in"
                title="Zoom in: more room for each day"
                className="rounded p-0.5 hover:bg-accent hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
              >
                <ZoomIn className="h-3.5 w-3.5" />
              </button>
              {/* Only once a zoom has been chosen: until then the scale already
                  is the automatic one, and the button would do nothing. */}
              {zoom !== null && (
                <button
                  type="button"
                  onClick={() => chooseZoom(null)}
                  title="Back to the scale chosen from the dates shown"
                  className="ml-1 rounded px-1 text-[11px] hover:bg-accent hover:text-foreground"
                >
                  Reset zoom
                </button>
              )}
            </div>
            <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
              <input
                type="checkbox"
                checked={datedOnly}
                onChange={(e) => setDatedOnlyChoice(e.target.checked)}
                className="h-3.5 w-3.5"
              />
              With dates only
            </label>
          </div>
          <div className="relative" style={{ width: trackWidth }}>
            {months.map((month) => (
              <div
                key={month.from}
                className="absolute top-0 flex h-6 items-center whitespace-nowrap border-l text-xs font-medium text-muted-foreground"
                style={{ left: (month.from - range.start) * width, width: month.days * width }}
              >
                {/* The name follows the scroll along its month, so a month whose
                    first days are off to the left still says which it is. */}
                {month.days * width >= 44 && (
                  <span className="sticky bg-background px-1.5" style={{ left: leftWidth }}>
                    {month.label}
                  </span>
                )}
              </div>
            ))}
            {/* Day numbers when a day is wide enough to hold one; otherwise the
                day each week begins on; nothing at all once weeks are slivers. */}
            {width >= 24
              ? Array.from({ length: totalDays }, (_, i) => range.start + i).map((day) => (
                  <div
                    key={day}
                    className={`absolute top-6 flex h-6 items-center justify-center text-[10px] tabular-nums ${
                      day === today ? "font-semibold text-primary" : "text-muted-foreground/70"
                    }`}
                    style={{ left: (day - range.start) * width, width }}
                  >
                    {Number(dayIso(day).slice(8))}
                  </div>
                ))
              : width >= 10
                ? weeks.map((day) => (
                    <div
                      key={day}
                      className="absolute top-6 flex h-6 items-center pl-0.5 text-[10px] tabular-nums text-muted-foreground/70"
                      style={{ left: (day - range.start) * width }}
                    >
                      {Number(dayIso(day).slice(8))}
                    </div>
                  ))
                : null}
          </div>
        </div>

        <div className="relative">
          {/* Behind the rows: weekends shaded, a line per week, and today. */}
          <div
            className="pointer-events-none absolute inset-y-0"
            style={{ left: leftWidth, width: trackWidth }}
            aria-hidden="true"
          >
            {width >= 10 &&
              Array.from({ length: totalDays }, (_, i) => range.start + i)
                .filter(isWeekend)
                .map((day) => (
                  <div
                    key={day}
                    className="absolute inset-y-0 bg-muted/40"
                    style={{ left: (day - range.start) * width, width }}
                  />
                ))}
            {(width >= 10 ? weeks : months.map((m) => m.from)).map((day) => (
              <div
                key={day}
                className="absolute inset-y-0 w-px bg-border/60"
                style={{ left: (day - range.start) * width }}
              />
            ))}
            <div
              className="absolute inset-y-0 w-0.5 bg-primary/70"
              style={{ left: todayLeft + width / 2 - 1 }}
              data-timeline-today
            />
          </div>

          {rowIds.length === 0 ? (
            <p className="sticky left-0 px-3 py-6 text-sm text-muted-foreground" style={{ width: "min(100%, 40rem)" }}>
              Nothing in this list yet.
            </p>
          ) : (
            rowIds.map((id) => {
              const item = workItems[id];
              if (!item) return null;
              // While its bar is dragged, the row draws where the drag has it.
              const dragging = drag?.id === id;
              const shown = dragging ? { ...item, ...dragDates(item, drag.mode, drag.days, today) } : item;
              const bar = barFor(shown, today);
              const selected = selectedWorkItemIds.includes(id);
              const depth = allRows.depths.get(id) ?? 0;
              return (
                <div
                  key={id}
                  data-timeline-row={id}
                  aria-selected={selected}
                  onClick={(e) => selectWorkItem(id, e.ctrlKey || e.metaKey)}
                  className={`group flex border-b border-border/40 ${selected ? "bg-accent/60" : "hover:bg-accent/30"}`}
                  style={{ height: ROW_HEIGHT }}
                >
                  <div
                    className={`sticky left-0 z-10 flex shrink-0 items-center border-r pr-2 text-xs ${
                      selected ? "bg-accent" : "bg-background"
                    }`}
                    style={{ width: leftWidth, paddingLeft: 8 + depth * 12 }}
                    title={isScrambled ? undefined : item.title}
                  >
                    <span className="truncate">
                      {isScrambled ? scrambleName(item.title) : <IconizedTitle title={item.title} />}
                    </span>
                  </div>
                  <div className="relative" style={{ width: trackWidth }}>
                    {bar ? (
                      <>
                        <Bar
                          bar={bar}
                          pixels={barPixels(bar, range, width)}
                          color={statusColor(item)}
                          label={describeStartEnd(shown.startedOn, shown.endedOn)}
                          dragging={dragging}
                          onEdit={() => {
                            if (justDragged.current) {
                              justDragged.current = false;
                              return;
                            }
                            setEditing(id);
                          }}
                          onDragStart={(mode, e) => beginDrag(id, mode, e)}
                          onDragMove={moveDrag}
                          onDragEnd={endDrag}
                          onDragCancel={cancelDrag}
                        />
                        {/* The dates the drag would set, beside the bar as it moves. */}
                        {dragging && (
                          <span
                            className="pointer-events-none absolute top-1/2 z-10 -translate-y-1/2 whitespace-nowrap rounded bg-foreground px-1.5 py-0.5 text-[10px] tabular-nums text-background"
                            style={{
                              left: barPixels(bar, range, width).left + barPixels(bar, range, width).width + 8,
                            }}
                            role="status"
                          >
                            {formatStartEnd(shown.startedOn, shown.endedOn)}
                          </span>
                        )}
                      </>
                    ) : (
                      // An undated row: the whole track is the way to give it dates,
                      // said only on hover so a list of them stays quiet.
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setEditing(id);
                        }}
                        aria-label={`Set start and end dates for ${isScrambled ? "this item" : item.title}`}
                        className="absolute inset-0 flex items-center text-[10px] text-muted-foreground opacity-0 focus-visible:opacity-100 group-hover:opacity-100"
                      >
                        <span className="sticky left-0 pl-2" style={{ left: leftWidth }}>
                          Set dates…
                        </span>
                      </button>
                    )}
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      {editing && (
        <StartEndDatesDialog
          workItemIds={
            selectedWorkItemIds.length > 1 && selectedWorkItemIds.includes(editing) ? selectedWorkItemIds : [editing]
          }
          open
          onOpenChange={(open) => !open && setEditing(null)}
        />
      )}
    </div>
  );
}

/**
 * One item's mark on the calendar. Clicking it changes its dates; dragging it
 * moves them. A bar wide enough has an edge at each end to drag on its own.
 */
function Bar({
  bar,
  pixels,
  color,
  label,
  dragging,
  onEdit,
  onDragStart,
  onDragMove,
  onDragEnd,
  onDragCancel,
}: {
  bar: TimelineBar;
  pixels: { left: number; width: number };
  color: string;
  label: string;
  dragging: boolean;
  onEdit: () => void;
  onDragStart: (mode: DragMode, e: React.PointerEvent) => void;
  onDragMove: (e: React.PointerEvent) => void;
  onDragEnd: (e: React.PointerEvent) => void;
  onDragCancel: () => void;
}) {
  const common = {
    type: "button" as const,
    title: dragging ? undefined : `${label}. Drag to move, click to change`,
    "aria-label": `${label}. Change`,
    "data-bar-kind": bar.kind,
    onClick: (e: React.MouseEvent) => {
      e.stopPropagation();
      onEdit();
    },
    // Which part was taken hold of: an end, marked below, or the bar itself.
    onPointerDown: (e: React.PointerEvent) =>
      onDragStart(((e.target as HTMLElement).dataset?.handle as DragMode | undefined) ?? "move", e),
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragCancel,
  };
  // Dragging must not scroll the calendar or select its text.
  const grip = `touch-none select-none ${dragging ? "cursor-grabbing brightness-110" : "cursor-grab"}`;
  // Too narrow a bar has no room for ends of its own; all of it moves.
  const ends = Math.max(pixels.width, 6) >= 18;
  if (bar.kind === "end-only") {
    // A diamond centred on the day it ended.
    return (
      <button
        {...common}
        className={`absolute top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rotate-45 rounded-[1px] hover:brightness-110 ${grip}`}
        style={{ left: pixels.left + pixels.width / 2, backgroundColor: color }}
      />
    );
  }
  if (bar.kind === "planned") {
    // Not begun yet: an outline on the day it is due to.
    return (
      <button
        {...common}
        className={`absolute top-1/2 h-3.5 -translate-y-1/2 rounded-sm border-2 bg-background hover:brightness-110 ${grip}`}
        style={{ left: pixels.left, width: Math.max(pixels.width, 8), borderColor: color }}
      />
    );
  }
  return (
    <button
      {...common}
      className={`absolute top-1/2 h-3.5 -translate-y-1/2 hover:brightness-110 ${
        bar.kind === "ongoing" ? "rounded-l-sm" : "rounded-sm"
      } ${grip}`}
      style={{
        left: pixels.left,
        width: Math.max(pixels.width, 6),
        // Still going: solid where it began, fading towards today.
        background: bar.kind === "ongoing" ? `linear-gradient(to right, ${color} 40%, transparent)` : color,
      }}
    >
      {ends && (
        <>
          <span data-handle="start" className="absolute inset-y-0 left-0 w-1.5 cursor-ew-resize" />
          {/* On work still going this is its open end: dragging it gives the work an end date. */}
          <span data-handle="end" className="absolute inset-y-0 right-0 w-1.5 cursor-ew-resize" />
        </>
      )}
    </button>
  );
}
