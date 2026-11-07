/**
 * The flat lists that replace the tree while searching or filtering by label
 * or team: items from every tree, each with where it sits, and lists by name.
 */
import { useCallback, useEffect, useMemo, useRef } from "react";
import { useDraggable } from "@dnd-kit/core";
import { BellOff, GripVertical } from "lucide-react";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { useBacklogStatusesStore, getEffectiveStatusesForTree } from "@/store/backlogStatusesStore";
import { useIsMobile } from "@/hooks/use-mobile";
import { useWorkItemTotalMinutes } from "@/lib/timeTotals";
import { nothingFound, type ItemMatch, type Ranges } from "@/lib/itemSearch";
import { IconizedTitle } from "@/components/IconizedTitle";
import type { WorkItem } from "@/types/models";
import { formatDuration } from "../TimeLogDialog";
import { ItemMenu, type ItemActions } from "../workItemRow/ItemMenu";
import { ItemDialogs } from "../workItemRow/ItemDialogs";
import { rankToTopOfList, useCommonItemActions, useItemFeatures } from "../workItemRow/itemActions";
import { useRowDialogs } from "../workItemRow/useRowDialogs";
import { DRAG_THRESHOLD_PX_SQUARED, whenRowReady } from "../workItemRow/rowShared";
import type { ItemPlace } from "./itemPlaces";
import type { ItemSearch, SearchResult } from "./useItemSearch";
import type { ListFilters } from "./useListFilters";

/** A name with the places the search found its words marked. */
function MarkedTitle({ title, ranges }: { title: string; ranges: Ranges }) {
  const merged: Array<[number, number]> = [];
  for (const [from, to] of [...ranges].sort((a, b) => a[0] - b[0])) {
    const last = merged[merged.length - 1];
    if (last && from <= last[1]) last[1] = Math.max(last[1], to);
    else merged.push([from, to]);
  }
  if (merged.length === 0) return <IconizedTitle title={title} />;
  const parts: React.ReactNode[] = [];
  let at = 0;
  merged.forEach(([from, to], i) => {
    if (from > at) parts.push(<IconizedTitle key={`t${i}`} title={title.slice(at, from)} />);
    parts.push(
      <mark key={`m${i}`} className="bg-primary/20 text-foreground rounded-sm px-0 not-italic">
        {title.slice(from, to)}
      </mark>,
    );
    at = to;
  });
  if (at < title.length) parts.push(<IconizedTitle key="rest" title={title.slice(at)} />);
  return <>{parts}</>;
}

const MATCHED_IN_LABEL: Record<ItemMatch["elsewhere"][number]["in"], string> = {
  key: "Jira key",
  label: "label",
  description: "description",
  link: "link",
};

/**
 * A single row in the search-results or label-filter-results list.
 * Supports drag-and-drop (drop onto a backlog in the left panel) and a full
 * right-click context menu that is the one on regular work-item rows.
 */
function SearchResultItem({
  item,
  treeId,
  backlogId,
  idx,
  titleNode,
  workItemAncestors,
  treeName,
  backlogPath,
  isScrambled,
  onNavigate,
  active = false,
  note,
}: {
  item: WorkItem;
  treeId: string;
  backlogId: string;
  idx: number;
  titleNode: React.ReactNode;
  workItemAncestors: string[];
  treeName: string;
  backlogPath: string[];
  isScrambled: boolean;
  onNavigate: () => void;
  /** Chosen with the arrow keys in the search box. */
  active?: boolean;
  /** Where the search found it, when not in the name. */
  note?: string;
}) {
  const rowRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (active) rowRef.current?.scrollIntoView?.({ block: "nearest" });
  }, [active]);
  const backlogs = useAppStore((s) => s.backlogs);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(item.id));
  const isMobile = useIsMobile();
  const features = useItemFeatures(item, treeId);
  const itemTotalMinutesCached = useWorkItemTotalMinutes(item.id);
  const itemTotalMinutes = features.timeLogging ? itemTotalMinutesCached : 0;

  // The lists of this item's tree, for "Move to list".
  const treeBacklogIds = useMemo(() => {
    const ids: string[] = [];
    const collect = (id: string) => {
      ids.push(id);
      backlogs[id]?.childrenIds.forEach(collect);
    };
    Object.values(backlogs)
      .filter((b) => b.treeId === treeId && !b.parentId)
      .forEach((b) => collect(b.id));
    return ids;
  }, [backlogs, treeId]);

  // Search-result cards can span multiple backlogs; use the tree's default
  // status set (root backlog's effective statuses) for display.
  const statusesByBacklog = useBacklogStatusesStore((s) => s.statusesByBacklog);
  const treeStatuses = useMemo(
    () =>
      getEffectiveStatusesForTree(treeId).map((s) => ({ key: s.key, label: s.label, color: s.color, displayLabel: s.label })),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [treeId, statusesByBacklog],
  );

  // The item's menu and its dialogs: the same as on its row in the list. A
  // search result is not part of the list's selection, so they act on it alone.
  const dialogs = useRowDialogs();
  const actOn = useCallback(() => [item.id], [item.id]);
  const common = useCommonItemActions({ workItemId: item.id, actOn, dialogs, activeOrgId });
  /** Go to the item in its list, and once its row is there, do `then` on it. */
  const goThen = (then: () => void) => {
    onNavigate();
    whenRowReady(item.id, then);
  };
  const actions: ItemActions = {
    ...common,
    rankToTop: () => rankToTopOfList(item, treeId, backlogId),
    // A result's name is not edited here: go to the item and edit it there.
    startRename: () =>
      goThen(() => window.dispatchEvent(new CustomEvent("shortcut:edit-title", { detail: { workItemId: item.id } }))),
    addChild: () => goThen(() => window.dispatchEvent(new CustomEvent("shortcut:add-child-workitem"))),
  };

  const {
    attributes,
    listeners,
    setNodeRef,
    isDragging,
  } = useDraggable({
    id: `search-workitem-${item.id}`,
    data: {
      type: "workitem",
      workItemId: item.id,
      treeId,
      selectedIds: [item.id],
    },
  });

  const dragStartedRef = useRef(false);
  const pointerDownPosRef = useRef<{ x: number; y: number } | null>(null);
  const { onPointerDown: dndPointerDown, ...restListeners } = !isMobile ? (listeners ?? {}) : {};

  const statusColor = treeStatuses.find((s) => s.key === item.status)?.color ?? "#94a3b8";

  return (
    <>
      <div ref={(node) => { setNodeRef(node); rowRef.current = node; }} style={isDragging ? { opacity: 0.4 } : undefined}>
        <ContextMenu>
          <ContextMenuTrigger asChild>
            <div
              {...attributes}
              {...restListeners}
              role="option"
              aria-selected={active}
              className={`flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/30 last:border-b-0 group select-none${active ? " bg-accent" : ""}${!isMobile ? " cursor-grab active:cursor-grabbing" : ""}`}
              title={features.timeLogging && itemTotalMinutes > 0 ? `${formatDuration(itemTotalMinutes)} logged` : undefined}
              onPointerDown={(e) => {
                dndPointerDown?.(e);
                dragStartedRef.current = false;
                pointerDownPosRef.current = { x: e.clientX, y: e.clientY };
              }}
              onPointerMove={(e) => {
                if (!pointerDownPosRef.current) return;
                const dx = e.clientX - pointerDownPosRef.current.x;
                const dy = e.clientY - pointerDownPosRef.current.y;
                if (dx * dx + dy * dy >= DRAG_THRESHOLD_PX_SQUARED) {
                  dragStartedRef.current = true;
                }
              }}
              onPointerUp={() => {
                pointerDownPosRef.current = null;
              }}
              onClick={(e) => {
                e.stopPropagation();
                if (dragStartedRef.current) return;
                onNavigate();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter" || e.key === " ") {
                  e.preventDefault();
                  onNavigate();
                }
              }}
            >
              <span
                className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-5 text-right mt-1 select-none"
                aria-hidden="true"
              >
                {idx + 1}
              </span>
              <span
                className="w-3 h-3 rounded-full shrink-0 mt-1 border border-background/50"
                style={{ backgroundColor: statusColor }}
                title={item.status}
              />
              <div className="min-w-0 flex-1">
                <span className="text-sm leading-snug break-words inline-flex items-center gap-1">
                  {isSnoozed && (
                    <BellOff
                      className="w-3 h-3 text-amber-500/80 shrink-0 inline-block"
                      aria-label="Snoozed — hidden in list view; click to reveal"
                    />
                  )}
                  {titleNode}
                </span>
                {note && !isScrambled && (
                  <p className="text-[10px] text-muted-foreground mt-0 truncate italic">{note}</p>
                )}
                {workItemAncestors.length > 0 && (
                  <p className="text-[10px] text-muted-foreground/70 mt-0 truncate">
                    {isScrambled ? "···" : workItemAncestors.join(" › ")}
                  </p>
                )}
                <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                  {isScrambled ? "···" : [treeName, ...backlogPath].join(" › ")}
                </p>
              </div>
              {!isMobile && (
                <div className="shrink-0 mt-0.5 text-muted-foreground/30 opacity-0 group-hover:opacity-100 transition-opacity">
                  <GripVertical className="w-3.5 h-3.5" />
                </div>
              )}
            </div>
          </ContextMenuTrigger>
          <ItemMenu
            item={item}
            treeId={treeId}
            backlogId={backlogId}
            moveTargets={treeBacklogIds}
            statuses={treeStatuses}
            features={features}
            isScrambled={isScrambled}
            actOn={actOn}
            dialogs={dialogs}
            actions={actions}
          />
        </ContextMenu>
      </div>
      <ItemDialogs
        item={item}
        actOn={actOn}
        treeId={treeId}
        backlogId={backlogId}
        activeOrgId={activeOrgId}
        timeLoggingVisible={features.timeLogging}
        dialogs={dialogs}
        actions={actions}
      />
    </>
  );
}

/** The search's results, best first, fifty at a time; one may be chosen with the arrow keys. */
export function SearchResultsList({
  search,
  isScrambled,
  onOpen,
}: {
  search: ItemSearch;
  isScrambled: boolean;
  onOpen: (result: SearchResult) => void;
}) {
  const { results, shown, activeIndex } = search;
  return (
    <div className="flex-1 overflow-y-auto p-0 md:p-0.5" onClick={(e) => e.stopPropagation()}>
      {results && results.length > 0 ? (
        <div className="flex flex-col" role="listbox" aria-label="Search results">
          {shown.map((result, idx) => {
            const active = idx === activeIndex;
            if (result.kind === "backlog") {
              const { backlogId, treeName, backlogName, backlogPath, ranges } = result;
              return (
                <div
                  key={`backlog-${backlogId}`}
                  ref={(node) => { if (active) node?.scrollIntoView?.({ block: "nearest" }); }}
                  role="option"
                  aria-selected={active}
                  className={`flex items-start gap-2 px-3 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/30 last:border-b-0 cursor-pointer select-none${active ? " bg-accent" : ""}`}
                  onClick={(e) => {
                    e.stopPropagation();
                    onOpen(result);
                  }}
                >
                  <span
                    className="text-[10px] tabular-nums text-muted-foreground shrink-0 w-5 text-right mt-1 select-none"
                    aria-hidden="true"
                  >
                    {idx + 1}
                  </span>
                  <span className="w-3 h-3 rounded-full shrink-0 mt-1 border border-background/50 bg-muted-foreground/40" />
                  <div className="min-w-0 flex-1">
                    <span className="text-sm leading-snug break-words">
                      <MarkedTitle title={backlogName} ranges={ranges} />
                      <span className="text-[10px] text-muted-foreground ml-1">(list)</span>
                    </span>
                    <p className="text-[10px] text-muted-foreground mt-0.5 truncate">
                      {isScrambled ? "···" : [treeName, ...backlogPath].join(" › ")}
                    </p>
                  </div>
                </div>
              );
            }
            const { item, treeId, backlogId, treeName, backlogPath, workItemAncestors, ranges, elsewhere } = result;
            const note = elsewhere.length > 0
              ? elsewhere.map((e) => (e.in === "key" ? `Jira key ${e.snippet}` : `In ${MATCHED_IN_LABEL[e.in]}: ${e.snippet}`)).join(" · ")
              : undefined;
            return (
              <SearchResultItem
                key={`${item.id}::${treeId}`}
                item={item}
                treeId={treeId}
                backlogId={backlogId}
                idx={idx}
                titleNode={<MarkedTitle title={item.title} ranges={ranges} />}
                workItemAncestors={workItemAncestors}
                treeName={treeName}
                backlogPath={backlogPath}
                isScrambled={isScrambled}
                active={active}
                note={note}
                onNavigate={() => onOpen(result)}
              />
            );
          })}
          {results.length > shown.length && (
            <button
              type="button"
              className="m-2 self-center rounded-md border px-3 py-1 text-xs text-muted-foreground hover:bg-accent hover:text-foreground"
              onClick={(e) => {
                e.stopPropagation();
                search.showMore();
              }}
            >
              Show more ({results.length - shown.length} left)
            </button>
          )}
        </div>
      ) : results ? (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground px-4 text-center">
          {nothingFound(search.parsed, search.deferredQuery)}
        </div>
      ) : null}
    </div>
  );
}

/** The items the chosen labels and teams match, from every tree, by name. */
export function FilterResultsList({
  filters,
  isScrambled,
  onOpen,
}: {
  filters: ListFilters;
  isScrambled: boolean;
  onOpen: (place: ItemPlace) => void;
}) {
  const { results } = filters;
  return (
    <div className="flex-1 overflow-y-auto p-0 md:p-0.5" onClick={(e) => e.stopPropagation()}>
      {results && results.length > 0 ? (
        <div className="flex flex-col">
          {results.map((place, idx) => (
            <SearchResultItem
              key={`${place.item.id}::${place.treeId}`}
              item={place.item}
              treeId={place.treeId}
              backlogId={place.backlogId}
              idx={idx}
              titleNode={<IconizedTitle title={place.item.title} />}
              workItemAncestors={place.workItemAncestors}
              treeName={place.treeName}
              backlogPath={place.backlogPath}
              isScrambled={isScrambled}
              onNavigate={() => onOpen(place)}
            />
          ))}
        </div>
      ) : (
        <div className="flex items-center justify-center h-32 text-sm text-muted-foreground">
          No items match the selected filter{filters.labelIds.size + filters.teamIds.size !== 1 ? "s" : ""}
        </div>
      )}
    </div>
  );
}
