/**
 * What a row shows after its title: small marks for what the item has (a
 * respawn, dates, a snooze, links, a closed ad), and where it sits when that
 * is not plain from the list (its parents, its list, its other trees).
 */
import { BellOff, Ban, ChevronRight, Link2, RotateCcw } from "lucide-react";
import { useShallow } from "zustand/react/shallow";
import { Tooltip, TooltipContent, TooltipTrigger, TooltipProvider } from "@/components/ui/tooltip";
import { useAppStore } from "@/store/appStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { useClosedPostingsStore } from "@/store/closedPostingsStore";
import { describeStartEnd, formatStartEnd } from "@/lib/workItemStartEnd";
import { formatCreatedOn } from "@/lib/workItemCreated";
import { effectiveAncestors } from "@/lib/workItemRows";
import { scrambleName } from "@/lib/scramble";
import { IconizedTitle } from "@/components/IconizedTitle";
import type { WorkItem } from "@/types/models";
import type { RowDialog } from "./useRowDialogs";

export function RowBadges({
  item,
  startEndDatesVisible,
  createdDatesVisible,
  onOpen,
}: {
  item: WorkItem;
  startEndDatesVisible: boolean;
  createdDatesVisible: boolean;
  onOpen: (dialog: Extract<RowDialog, "startEnd" | "createdDate" | "hyperlinks">) => void;
}) {
  const workItemId = item.id;
  const unsnoozeWorkItem = useSnoozeStore((s) => s.unsnoozeWorkItem);
  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(workItemId));
  const activeSnooze = useSnoozeStore((s) => s.getActiveSnooze(workItemId));
  const hyperlinkCount = useAppStore((s) => (s.hyperlinks[workItemId] ?? []).length);
  const postingClosed = useClosedPostingsStore((s) => s.closed.has(workItemId));
  const postingUnknown = useClosedPostingsStore((s) => s.unknown.has(workItemId));
  return (
    <>
      {item.respawnEnabled && (() => {
        const days = item.respawnIntervalDays ?? 7;
        return (
          <TooltipProvider>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="shrink-0 mt-0.5 text-primary/70" onClick={(e) => e.stopPropagation()}>
                  <RotateCcw className="w-3 h-3" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="top" className="text-xs">
                Respawns every {days} day{days !== 1 ? "s" : ""}
                {item.respawnHour != null ? ` at ${item.respawnHour}:00` : ""}
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        );
      })()}

      {/* When the work ran, as one span: "1.10.–5.10.", or "1.10.–" while
          it is still going. After the title, beside the created date.
          Clicking it changes it. Rows with neither date show nothing. */}
      {startEndDatesVisible && (item.startedOn || item.endedOn) && (
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded px-1 text-xs tabular-nums text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground"
          title={describeStartEnd(item.startedOn, item.endedOn)}
          aria-label={`${describeStartEnd(item.startedOn, item.endedOn)}. Change`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen("startEnd");
          }}
        >
          {formatStartEnd(item.startedOn, item.endedOn)}
        </button>
      )}

      {/* The day it was made, after the title and out of its way: a fact
          about the row rather than something to act on, unlike the
          deadline that leads it. Clicking it corrects it. Rows whose day
          was never recorded show nothing; theirs is set from the menu. */}
      {createdDatesVisible && item.createdOn && (
        <button
          type="button"
          className="mt-0.5 shrink-0 rounded px-1 text-xs tabular-nums text-muted-foreground/70 hover:bg-muted hover:text-muted-foreground"
          title={`Created ${item.createdOn}`}
          aria-label={`Created ${formatCreatedOn(item.createdOn)}. Change`}
          onClick={(e) => {
            e.stopPropagation();
            onOpen("createdDate");
          }}
        >
          {formatCreatedOn(item.createdOn)}
        </button>
      )}

      {isSnoozed && activeSnooze && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="shrink-0 mt-0.5 text-amber-500/80 hover:text-amber-500 transition-colors"
                onClick={(e) => { e.stopPropagation(); unsnoozeWorkItem(workItemId); }}
              >
                <BellOff className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              Snoozed until {new Date(activeSnooze.snoozedUntil).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (click to unsnooze)
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {hyperlinkCount > 0 && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                className="shrink-0 mt-0.5 text-primary/70 hover:text-primary transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onOpen("hyperlinks");
                }}
              >
                <Link2 className="w-3 h-3" />
              </button>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              {hyperlinkCount} hyperlink{hyperlinkCount !== 1 ? "s" : ""}
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* Set by the header's ad check, and only until the page reloads:
          the posting said it is no longer taking applications. */}
      {postingClosed && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 mt-0.5 flex items-center gap-0.5 rounded px-1 text-[10px] font-medium bg-destructive/10 text-destructive">
                <Ban className="w-2.5 h-2.5" />
                Closed
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              This ad is no longer accepting applications
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}

      {/* The check reached nothing here, which is not the same as the ad
          being live — say so rather than leave the row looking checked. */}
      {postingUnknown && !postingClosed && (
        <TooltipProvider>
          <Tooltip>
            <TooltipTrigger asChild>
              <span className="shrink-0 mt-0.5 rounded px-1 text-[10px] font-medium bg-muted text-muted-foreground">
                ?
              </span>
            </TooltipTrigger>
            <TooltipContent side="top" className="text-xs">
              The board would not answer, so this one is unchecked
            </TooltipContent>
          </Tooltip>
        </TooltipProvider>
      )}
    </>
  );
}

/** A list's path from the top of its tree, as names. */
function backlogPath(backlogs: ReturnType<typeof useAppStore.getState>["backlogs"], backlogId: string) {
  const path: { id: string; name: string }[] = [];
  let current = backlogs[backlogId];
  while (current) {
    path.unshift({ id: current.id, name: current.name });
    current = current.parentId ? backlogs[current.parentId] : undefined;
  }
  return path;
}

export function RowWhereabouts({
  item,
  depth,
  treeId,
  backlogId,
  parentBacklogId,
  isChildBacklog,
  isScrambled,
}: {
  item: WorkItem;
  depth: number;
  treeId: string;
  backlogId: string;
  parentBacklogId?: string;
  isChildBacklog: boolean;
  isScrambled: boolean;
}) {
  const backlogs = useAppStore((s) => s.backlogs);
  const selectBacklog = useAppStore((s) => s.selectBacklog);
  // A top-level row whose parent is outside the backlog in view shows where it
  // sits — by its parents in this tree, not its global ones.
  const ancestors = useAppStore(
    useShallow((s) => (depth === 0 ? effectiveAncestors(item.id, s.workItems, treeId) : NO_ANCESTORS)),
  );

  const backlogPaths = Object.entries(item.backlogAssignments)
    .filter(([tid]) => tid !== treeId)
    .map(([tid, blId]) => ({ treeId: tid, path: backlogPath(backlogs, blId) }))
    .filter(({ path }) => path.length > 0);

  return (
    <>
      {ancestors.length > 0 && (
        <div className="hidden md:flex items-center shrink-0 mt-0.5 text-[10px] text-muted-foreground/70 max-w-[200px]">
          {ancestors.map((ancestor, i) => (
            <span key={ancestor.id} className="flex items-center min-w-0">
              {i > 0 && <ChevronRight className="w-2.5 h-2.5 mx-0.5 opacity-40 shrink-0" />}
              <span className="truncate">{isScrambled ? scrambleName(ancestor.title) : <IconizedTitle title={ancestor.title} />}</span>
            </span>
          ))}
          <ChevronRight className="w-2.5 h-2.5 mx-0.5 opacity-40 shrink-0" />
        </div>
      )}

      {(isChildBacklog || backlogPaths.length > 0) && (
        <div className="hidden md:flex items-center gap-1.5 shrink-0 ml-auto mt-0.5">
          {isChildBacklog && (parentBacklogId === undefined || backlogId !== parentBacklogId) && backlogs[backlogId] && (
            <div className="flex items-center text-[10px] text-muted-foreground/70">
              <span className="mr-0.5">in</span>
              <button
                className="hover:text-foreground hover:underline transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  selectBacklog(backlogId, treeId);
                }}
              >
                {isScrambled ? scrambleName(backlogs[backlogId].name) : backlogs[backlogId].name}
              </button>
            </div>
          )}
          {backlogPaths.map(({ treeId: tid, path }) => (
            <div key={tid} className="flex items-center text-[10px] text-foreground">
              <span className="mr-0.5">also in</span>
              {path.map((seg, i) => (
                <span key={seg.id} className="flex items-center">
                  {i > 0 && <ChevronRight className="w-2.5 h-2.5 mx-0.5 opacity-40" />}
                  <button
                    className="hover:text-foreground hover:underline transition-colors"
                    onClick={(e) => {
                      e.stopPropagation();
                      selectBacklog(seg.id, tid);
                    }}
                  >
                    {isScrambled ? scrambleName(seg.name) : seg.name}
                  </button>
                </span>
              ))}
            </div>
          ))}
        </div>
      )}
    </>
  );
}

const NO_ANCESTORS: WorkItem[] = [];
