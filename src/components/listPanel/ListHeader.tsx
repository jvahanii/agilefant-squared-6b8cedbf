/**
 * The heading over the list: its name (double-click to rename), how many
 * items and how many selected, and its buttons — list, board or timeline;
 * wake the snoozed; check the job ads for closed ones; paste; sort; log time;
 * add. Right-clicked, it offers the list's own menu, as the tree on the left
 * does, and it holds the dialogs that menu opens.
 *
 * While searching or filtering, ResultsHeader stands in its place.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ArrowDownAZ, Ban, BellOff, ChartGantt, ClipboardPaste, Clock, LayoutGrid, List as ListIcon, Lock, Plus, X } from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { ContextMenu, ContextMenuContent, ContextMenuTrigger } from "@/components/ui/context-menu";
import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { useSnoozeStore } from "@/store/snoozeStore";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { useScrambledListsStore } from "@/store/scrambledListsStore";
import { refuseRenameOfScrambledList } from "@/store/listScrambleStore";
import { closedCheckMessage, linkedItemsIn, useClosedPostingsStore } from "@/store/closedPostingsStore";
import { saveTopLevelOrderAsRank, useListSortMode, useListSortStore } from "@/store/listSortStore";
import { useScramble } from "@/contexts/ScrambleContext";
import { useIsMobile } from "@/hooks/use-mobile";
import { useDeleteWithTimeGuard } from "@/hooks/useDeleteWithTimeGuard";
import { toast } from "@/hooks/use-toast";
import { focusForEdit } from "@/lib/focusEdit";
import { scrambleName } from "@/lib/scramble";
import { backlogPoints } from "@/lib/backlogPoints";
import { computeBacklogTotalMinutes } from "@/lib/timeUtils";
import { listSortLabel, listSortModes, type ListSortMode } from "@/lib/listSort";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { useDeadlinesEnabled } from "@/lib/workItemDeadline";
import { useCreatedDatesEnabled } from "@/lib/workItemCreated";
import { IconizedTitle } from "@/components/IconizedTitle";
import { PublishBacklogDialog } from "@/components/PublicLinkControls";
import { ActionPrompt } from "../ActionPrompt";
import { BacklogContextMenuItems } from "../BacklogContextMenuItems";
import { BacklogPointsDialog } from "../BacklogPointsDialog";
import { BacklogStatusesDialog } from "../BacklogStatusesDialog";
import { ListHeadingLabels } from "../LabelNames";
import { MobileBacklogAttributesSheet } from "../MobileAttributesSheet";
import { TimeLogDialog, formatDuration } from "../TimeLogDialog";

/** The list's name in the heading, renamed in place on a double click. */
function EditableBacklogName({ backlogId, isScrambled }: { backlogId: string; isScrambled: boolean }) {
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const renameBacklog = useAppStore((s) => s.renameBacklog);
  // Scrambled for everyone from the list's menu: marked, and not editable.
  const isNameScrambled = useScrambledListsStore((s) => s.byList.has(backlogId));
  const isMobile = useIsMobile();
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditing) focusForEdit(inputRef.current, isMobile);
  }, [isEditing, isMobile]);

  const startEditing = () => {
    if (refuseRenameOfScrambledList(backlogId)) return;
    setEditValue(backlog?.name ?? "");
    setIsEditing(true);
  };
  const commitEdit = () => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== backlog?.name) renameBacklog(backlogId, trimmed);
    setIsEditing(false);
  };

  // "Insert icon" from the backlog's right-click menu over the header: at the
  // cursor while the name is being edited, otherwise at the end of the name in
  // the editor, to confirm or move — as the same item does in the tree.
  useEffect(() => {
    const onInsert = (e: Event) => {
      const { backlogId: target, shortcode } = (e as CustomEvent<{ backlogId: string; shortcode: string }>).detail;
      if (target !== backlogId) return;
      const inp = inputRef.current;
      if (isEditing && inp) {
        const start = inp.selectionStart ?? editValue.length;
        const end = inp.selectionEnd ?? start;
        setEditValue(editValue.slice(0, start) + shortcode + editValue.slice(end));
        requestAnimationFrame(() => {
          inp.focus();
          inp.setSelectionRange(start + shortcode.length, start + shortcode.length);
        });
      } else if (!refuseRenameOfScrambledList(backlogId)) {
        setEditValue((backlog?.name ?? "") + shortcode);
        setIsEditing(true);
      }
    };
    window.addEventListener("backlog-name:insert-icon", onInsert);
    return () => window.removeEventListener("backlog-name:insert-icon", onInsert);
  }, [backlogId, isEditing, editValue, backlog?.name]);

  if (!backlog) return null;

  if (isEditing) {
    return (
      <input
        ref={inputRef}
        className="text-base font-semibold bg-transparent border-b border-primary/40 outline-none px-0.5 py-0 min-w-0 w-full"
        value={editValue}
        onChange={(e) => setEditValue(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") commitEdit();
          if (e.key === "Escape") setIsEditing(false);
          e.stopPropagation();
        }}
        onBlur={commitEdit}
        onClick={(e) => e.stopPropagation()}
      />
    );
  }

  return (
    <h2
      className="text-base font-semibold cursor-text hover:text-primary transition-colors break-words whitespace-normal"
      onDoubleClick={(e) => {
        e.stopPropagation();
        startEditing();
      }}
    >
      {isNameScrambled && (
        <Lock
          className="mr-1.5 inline-block h-3.5 w-3.5 align-[-1px] text-muted-foreground"
          aria-label="This list is scrambled"
        />
      )}
      {isScrambled ? scrambleName(backlog.name) : <IconizedTitle title={backlog.name} />}
      <ListHeadingLabels backlogId={backlogId} />
    </h2>
  );
}

/** The heading while searching or filtering: what the results are, and how many. */
export function ResultsHeader({ title, count }: { title: string; count: number }) {
  return (
    <div className="p-0.5 pb-0 md:p-1 md:pb-0.5 border-b flex items-start justify-between shrink-0">
      <div className="min-w-0 flex-1">
        <h2 className="text-base font-semibold">{title}</h2>
        <p className="text-xs text-foreground mt-0.5">
          {count} item{count !== 1 ? "s" : ""} found
        </p>
      </div>
    </div>
  );
}

/**
 * A job ad goes stale where nothing in the app can see it: applications close
 * on the board, and the item sits on the list as though it were live. Finding
 * out means fetching each posting, which only the server can do -- a job board
 * sends no CORS headers -- so the check is a button rather than something that
 * happens by itself, and only a superuser's, whose call it is to spend a burst
 * of server requests. It has nothing to do with whether the backlog is shared.
 */
function useClosedAdsCheck(treeId: string, backlogIdSet: Set<string>) {
  const { isSuperuser } = useScramble();
  const workItems = useAppStore((s) => s.workItems);
  const hyperlinks = useAppStore((s) => s.hyperlinks);
  // Every item in the backlog and its children that has a link to check.
  const linkedItems = useMemo(() => {
    if (!isSuperuser || backlogIdSet.size === 0 || !treeId) return [];
    return linkedItemsIn(workItems, hyperlinks, treeId, backlogIdSet);
  }, [isSuperuser, workItems, hyperlinks, backlogIdSet, treeId]);
  const checking = useClosedPostingsStore((s) => s.checking);
  const progress = useClosedPostingsStore((s) => s.progress);
  const closedIds = useClosedPostingsStore((s) => s.closed);
  const check = useClosedPostingsStore((s) => s.check);
  const forget = useClosedPostingsStore((s) => s.forget);
  // Marks are kept per item, so they stay put when another backlog is opened —
  // an import checks two lists at once, and switching between them must not
  // lose half the answer. The count is of this backlog's items only.
  const closedCount = useMemo(() => linkedItems.filter((item) => closedIds.has(item.id)).length, [linkedItems, closedIds]);
  const run = useCallback(async () => {
    toast(closedCheckMessage(await check(linkedItems)));
  }, [check, linkedItems]);
  return { linkedItems, checking, progress, closedCount, run, forget: () => forget(linkedItems.map((item) => item.id)) };
}

/** The view buttons: list, and board or timeline where the organization uses them. */
function ViewButtons({
  view,
}: {
  view: ListView;
}) {
  const { mode, set, boardsVisible, timelineAvailable, showTimeline } = view;
  return (
    <div className="flex items-center rounded-md border bg-muted/40 mr-1 overflow-hidden">
      <button
        className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${!(boardsVisible && mode === "board") && !showTimeline ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        onClick={(e) => { e.stopPropagation(); set("list"); }}
        title="List view"
      >
        <ListIcon className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">List</span>
      </button>
      {boardsVisible && (
      <button
        className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${mode === "board" ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        onClick={(e) => { e.stopPropagation(); set("board"); }}
        title="Board view (leaf items by status)"
      >
        <LayoutGrid className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Board</span>
      </button>
      )}
      {timelineAvailable && (
      <button
        className={`flex items-center gap-1 h-7 px-2 text-xs font-medium transition-colors ${showTimeline ? "bg-background text-foreground shadow-sm" : "text-muted-foreground hover:text-foreground"}`}
        onClick={(e) => { e.stopPropagation(); set("timeline"); }}
        title="Timeline view (items by start and end date)"
      >
        <ChartGantt className="w-3.5 h-3.5" />
        <span className="hidden sm:inline">Timeline</span>
      </button>
      )}
    </div>
  );
}

/**
 * The list's sort. A view only — nothing is saved until "Save current order
 * as rank" — so it lives in the list view, not on the board, and says which
 * order is showing whenever it is not rank, so a sorted list is never
 * mistaken for the ranked one.
 */
function SortMenu({ backlogId, treeId, allBacklogIds }: { backlogId: string; treeId: string; allBacklogIds: string[] }) {
  const mode = useListSortMode(backlogId);
  const setMode = useListSortStore((s) => s.setMode);
  // "Rating ★ best first" is offered where the organization rates its items
  // and this backlog has its stars switched on; deadline and created-date
  // sorts where those are used.
  const orgRatings = useRatingsEnabled();
  const deadlines = useDeadlinesEnabled();
  const orgCreatedDates = useCreatedDatesEnabled();
  const createdDates = useAppStore((s) => orgCreatedDates && !!s.backlogs[backlogId]?.createdDatesEnabled);
  const ratings = useAppStore((s) => orgRatings && !!s.backlogs[backlogId]?.ratingsEnabled);
  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <button
          className={`h-7 flex items-center justify-center gap-1 rounded-md transition-colors ${
            mode === "rank"
              ? "w-7 text-muted-foreground hover:text-foreground hover:bg-accent"
              : "px-2 border border-primary/30 bg-primary/10 text-primary hover:bg-primary/20"
          }`}
          onClick={(e) => e.stopPropagation()}
          title={mode === "rank" ? "Sort top-level items" : `Sorted by ${listSortLabel(mode)} — shown in this order only for you`}
        >
          <ArrowDownAZ className="w-4 h-4" />
          {mode !== "rank" && <span className="hidden sm:inline text-xs font-medium">{listSortLabel(mode)}</span>}
        </button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" onClick={(e) => e.stopPropagation()}>
        <DropdownMenuLabel className="text-xs text-muted-foreground font-normal">
          Sort top-level items
        </DropdownMenuLabel>
        <DropdownMenuRadioGroup value={mode} onValueChange={(value) => setMode(backlogId, value as ListSortMode)}>
          {listSortModes(ratings, deadlines, createdDates).map(({ mode: m, label }) => (
            <DropdownMenuRadioItem key={m} value={m} className="text-xs">
              {label}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
        {mode !== "rank" && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem
              className="text-xs"
              onSelect={() => {
                saveTopLevelOrderAsRank(treeId, backlogId, allBacklogIds);
                // The shown order is the rank now, so rank shows the same list.
                setMode(backlogId, "rank");
                toast({ title: "Order saved as rank", description: "Press Ctrl+Z to undo" });
              }}
            >
              Save current order as rank
            </DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/** How the list is shown, and the switches that decide which views are offered. */
export interface ListView {
  /** The view the list has saved; "board" counts only where boards are on. */
  mode: "list" | "board" | "timeline";
  set: (mode: "list" | "board" | "timeline") => void;
  boardsVisible: boolean;
  timelineAvailable: boolean;
  showTimeline: boolean;
}

export function ListHeader({
  backlogId,
  treeId,
  backlogIdSet,
  allBacklogIds,
  isScrambled,
  itemCount,
  snoozedItemIds,
  view,
  onAdd,
}: {
  backlogId: string;
  treeId: string;
  /** The list and the lists under it. */
  backlogIdSet: Set<string>;
  allBacklogIds: string[];
  isScrambled: boolean;
  /** The items at the top level of the list. */
  itemCount: number;
  snoozedItemIds: Set<string>;
  view: ListView;
  onAdd: () => void;
}) {
  const selectedCount = useAppStore((s) => s.selectedWorkItemIds.length);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const timeLoggingVisible = useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.timeLoggingEnabled ?? false);
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const unsnoozeAll = useSnoozeStore((s) => s.unsnoozeAll);
  const deleteBacklog = useAppStore((s) => s.deleteBacklog);
  const guardedDelete = useDeleteWithTimeGuard();
  const closedAds = useClosedAdsCheck(treeId, backlogIdSet);

  const totalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return computeBacklogTotalMinutes(backlogId, treeId, backlogs, workItems, timeEntries);
  }, [timeEntries, workItems, backlogs, backlogId, treeId, timeLoggingVisible]);

  // Work items in the list that are snoozed now.
  const snoozedInBacklog = useMemo(() => {
    if (snoozedItemIds.size === 0 || backlogIdSet.size === 0) return [];
    return Object.values(workItems)
      .filter((wi) => snoozedItemIds.has(wi.id) && backlogIdSet.has(wi.backlogAssignments[treeId]))
      .map((wi) => wi.id);
  }, [workItems, snoozedItemIds, backlogIdSet, treeId]);

  const [showTimeLog, setShowTimeLog] = useState(false);
  const [showAttributes, setShowAttributes] = useState(false);
  // The list's public link, reachable on a phone through its attributes sheet;
  // the desktop has it in the sidebar's context menu.
  const [showPublish, setShowPublish] = useState(false);
  const [showStatuses, setShowStatuses] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showPoints, setShowPoints] = useState(false);

  /** Each line on the clipboard as an item: under the one selected item, or at the top. */
  const pasteFromClipboard = async () => {
    try {
      const text = await navigator.clipboard.readText();
      const titles = text
        .split("\n")
        .map((t) => t.trim())
        .filter(Boolean);
      if (titles.length === 0) return;
      const state = useAppStore.getState();
      const selected = state.selectedWorkItemIds;
      const parentId = selected.length === 1 ? selected[0] : null;
      const parentBacklogId =
        parentId && state.workItems[parentId]?.backlogAssignments?.[treeId]
          ? state.workItems[parentId].backlogAssignments[treeId]
          : backlogId;
      state.bulkAddWorkItems(titles, parentId, parentBacklogId, treeId);
      if (parentId && !state.expandedWorkItems.has(parentId)) state.toggleWorkItemExpand(parentId);
    } catch (err) {
      console.error("Failed to read clipboard:", err);
    }
  };

  const backlogName = backlogs[backlogId]?.name ?? "";
  const sortable = itemCount > 1 && !(view.boardsVisible && view.mode === "board") && !view.showTimeline;

  return (
    <>
      <ContextMenu>
        <ContextMenuTrigger asChild>
          <div className="p-0.5 pb-0 md:p-1 md:pb-0.5 border-b flex items-start justify-between shrink-0">
            <div className="min-w-0 flex-1">
              <EditableBacklogName backlogId={backlogId} isScrambled={isScrambled} />
              <p className="text-xs text-foreground mt-0.5">
                {`${itemCount} item${itemCount !== 1 ? "s" : ""}`}
                {selectedCount > 0 && <span className="text-primary font-medium"> · {selectedCount} selected</span>}
              </p>
            </div>
            <div className="flex items-center gap-1 shrink-0 ml-2">
              {(view.boardsVisible || view.timelineAvailable) && <ViewButtons view={view} />}
              {snoozedInBacklog.length > 0 && (
                <button
                  className="flex items-center gap-1 w-auto h-7 px-2 rounded-md border border-amber-500/30 bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    unsnoozeAll(snoozedInBacklog);
                  }}
                  title={`${snoozedInBacklog.length} item${snoozedInBacklog.length !== 1 ? "s" : ""} hidden by snooze — click to unsnooze all`}
                >
                  <BellOff className="w-4 h-4" />
                  <span className="text-xs font-medium tabular-nums">Snoozed: {snoozedInBacklog.length}</span>
                </button>
              )}
              {closedAds.linkedItems.length > 0 && (
                <button
                  className={`flex items-center gap-1 w-auto h-7 px-2 rounded-md border transition-colors disabled:opacity-60 ${
                    closedAds.closedCount > 0
                      ? "border-destructive/30 bg-destructive/10 text-destructive hover:bg-destructive/20"
                      : "border-border text-muted-foreground hover:text-foreground hover:bg-accent"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation();
                    void closedAds.run();
                  }}
                  disabled={closedAds.checking}
                  title={`Check the ${closedAds.linkedItems.length} linked item${closedAds.linkedItems.length !== 1 ? "s" : ""} in this list and mark the ads that have closed. Nothing is saved.`}
                >
                  <Ban className={`w-4 h-4 ${closedAds.checking ? "animate-pulse" : ""}`} />
                  {/* A count is worth the width on any screen; the invitation to
                      press is not, so it steps aside on a phone the way the
                      list/board labels do. */}
                  <span className={`text-xs font-medium tabular-nums ${closedAds.checking || closedAds.closedCount > 0 ? "" : "hidden sm:inline"}`}>
                    {closedAds.checking
                      ? `Checking ${closedAds.progress?.done ?? 0}/${closedAds.progress?.total ?? 0}`
                      : closedAds.closedCount > 0
                        ? `Closed: ${closedAds.closedCount}`
                        : "Check for closed ads"}
                  </span>
                </button>
              )}
              {/* Marks outlive a change of backlog now, so they need a way off
                  other than reloading: this clears the ones in view. */}
              {closedAds.closedCount > 0 && !closedAds.checking && (
                <button
                  className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                  onClick={(e) => {
                    e.stopPropagation();
                    closedAds.forget();
                  }}
                  title="Clear the closed-ad marks in this list"
                  aria-label="Clear the closed-ad marks in this list"
                >
                  <X className="w-4 h-4" />
                </button>
              )}
              <button
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  void pasteFromClipboard();
                }}
                title="Paste items from clipboard"
              >
                <ClipboardPaste className="w-4 h-4" />
              </button>
              {sortable && <SortMenu backlogId={backlogId} treeId={treeId} allBacklogIds={allBacklogIds} />}
              {timeLoggingVisible && (
                <button
                  className="flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors px-1 min-w-[1.75rem] h-7"
                  onClick={(e) => {
                    e.stopPropagation();
                    setShowTimeLog(true);
                  }}
                  title="Log time for this list"
                >
                  {totalMinutes > 0 ? (
                    <span className="text-xs font-medium tabular-nums">{formatDuration(totalMinutes)}</span>
                  ) : (
                    <Clock className="w-4 h-4" />
                  )}
                </button>
              )}
              <button
                className="w-7 h-7 flex items-center justify-center rounded-md text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                onClick={(e) => {
                  e.stopPropagation();
                  onAdd();
                }}
                title="Add work item (Enter)"
              >
                <Plus className="w-4 h-4" />
              </button>
            </div>
          </div>
        </ContextMenuTrigger>
        {/* The same menu as right-clicking this backlog in the tree. */}
        <ContextMenuContent className="w-44">
          <BacklogContextMenuItems
            backlogId={backlogId}
            treeId={treeId}
            isScrambled={isScrambled}
            onInsertIcon={(shortcode) =>
              window.dispatchEvent(new CustomEvent("backlog-name:insert-icon", { detail: { backlogId, shortcode } }))
            }
            onAttributes={() => setShowAttributes(true)}
            onStatuses={() => setShowStatuses(true)}
            onPoints={() => setShowPoints(true)}
            onPublish={() => setShowPublish(true)}
            onDelete={() => setShowDeleteConfirm(true)}
          />
        </ContextMenuContent>
      </ContextMenu>
      {timeLoggingVisible && <TimeLogDialog backlogId={backlogId} open={showTimeLog} onOpenChange={setShowTimeLog} />}
      {showAttributes && (
        <MobileBacklogAttributesSheet
          backlogId={backlogId}
          totalPoints={backlogPoints(backlogId, treeId, workItems, backlogs).effective}
          open={showAttributes}
          onOpenChange={setShowAttributes}
          onOpenTimeLog={() => setShowTimeLog(true)}
          onOpenPublicLink={() => setShowPublish(true)}
        />
      )}
      {showPublish && (
        <PublishBacklogDialog treeId={treeId} backlogId={backlogId} backlogName={backlogName} open onOpenChange={setShowPublish} />
      )}
      {showPoints && <BacklogPointsDialog backlogId={backlogId} treeId={treeId} open onOpenChange={setShowPoints} />}
      {showStatuses && (
        <BacklogStatusesDialog backlogId={backlogId} backlogName={backlogName} open={showStatuses} onOpenChange={setShowStatuses} />
      )}
      {showDeleteConfirm && (
        <ActionPrompt
          title="Delete list?"
          options={[
            {
              label: "Delete",
              description: `Permanently delete "${isScrambled ? scrambleName(backlogName) : backlogName}" and all its contents. This action cannot be undone.`,
              value: "confirm",
              variant: "destructive",
              isDefault: true,
            },
          ]}
          onSelect={() => {
            setShowDeleteConfirm(false);
            guardedDelete({ kind: "backlog", id: backlogId }, backlogs[backlogId]?.name ?? "this list", () => deleteBacklog(backlogId));
          }}
          onCancel={() => setShowDeleteConfirm(false)}
        />
      )}
    </>
  );
}
