import { useState, useRef, useEffect, useMemo } from "react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { useAppStore } from "@/store/appStore";
import { itemEffectivePoints } from "@/lib/backlogPoints";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore, usePublicLinksEnabled } from "@/store/orgSettingsStore";
import { usePointsVisibleForTree, usePointsVisibleForTrees } from "@/lib/pointsVisibility";
import { useRatingsEnabled } from "@/lib/ratingsVisibility";
import { StarRating } from "@/components/StarRating";
import { useDeadlinesEnabled } from "@/lib/workItemDeadline";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { computeWorkItemTotalMinutes } from "@/lib/timeUtils";
import { useLabelsStore } from "@/store/labelsStore";
import { formatDuration } from "./TimeLogDialog";
import { LabelPicker } from "./LabelPicker";
import { IconizedTitle } from "@/components/IconizedTitle";
import { Bell, BellOff, Clock, Copy, FolderInput, GitBranch, Globe, Link2, Lock, RotateCcw, Tag } from "lucide-react";
import { useSnoozeStore } from "@/store/snoozeStore";
import { Button } from "@/components/ui/button";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { usePublishedLinksStore } from "@/store/publishedLinksStore";
import { peekCurrentUser } from "@/lib/currentUser";

const DEFAULT_MOBILE_ORG_SETTINGS = {
  pointsEnabled: false,
  timeLoggingEnabled: false,
  labelsEnabled: false,
};

// ─── Work Item Attributes Sheet ──────────────────────────────────────────────

interface MobileWorkItemAttributesSheetProps {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTimeLog: () => void;
  onOpenRespawn: () => void;
  onOpenHyperlinks: () => void;
  onOpenSnooze: () => void;
  onOpenMove: () => void;
  onOpenReparent: () => void;
  onDuplicate: () => void;
  /** Scrambling this item's name — the same actions the desktop row offers in
   *  its context menu, which a phone has no way to reach. */
  onScrambleName: () => void;
  onRevealName: () => void;
  onUnscrambleName: () => void;
}

export function MobileWorkItemAttributesSheet({
  workItemId,
  open,
  onOpenChange,
  onOpenTimeLog,
  onOpenRespawn,
  onOpenHyperlinks,
  onOpenSnooze,
  onOpenMove,
  onOpenReparent,
  onDuplicate,
  onScrambleName,
  onRevealName,
  onUnscrambleName,
}: MobileWorkItemAttributesSheetProps) {
  const scrambledBy = useScrambledItemsStore((s) => s.byItem.get(workItemId));
  const isNameScrambled = useScrambledItemsStore((s) => s.byItem.has(workItemId));
  const scrambledByMe = isNameScrambled && scrambledBy === (peekCurrentUser()?.id ?? null);
  const item = useAppStore((s) => s.workItems[workItemId]);
  const workItems = useAppStore((s) => s.workItems);
  const setWorkItemPoints = useAppStore((s) => s.setWorkItemPoints);
  const setWorkItemRating = useAppStore((s) => s.setWorkItemRating);
  const setWorkItemDeadline = useAppStore((s) => s.setWorkItemDeadline);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const orgSettings = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""] ?? DEFAULT_MOBILE_ORG_SETTINGS,
  );
  const assignedTreeIds = useMemo(
    () => (item ? Object.keys(item.backlogAssignments) : []),
    [item],
  );
  const pointsVisible = usePointsVisibleForTrees(assignedTreeIds);
  const ratingsVisible = useRatingsEnabled();
  const deadlinesVisible = useDeadlinesEnabled();
  const timeLoggingVisible = orgSettings.timeLoggingEnabled;
  const labelsVisible = orgSettings.labelsEnabled ?? false;

  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const itemTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return computeWorkItemTotalMinutes(workItemId, workItems, timeEntries);
  }, [timeEntries, workItemId, workItems, timeLoggingVisible]);

  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const itemLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const labelIds = byEntity[`work_item:${workItemId}`] ?? [];
    return labelIds
      .map((id) => labelsMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsVisible, byEntity, labelsMap, workItemId]);

  const hyperlinkCount = useAppStore((s) => (s.hyperlinks[workItemId] ?? []).length);

  const isSnoozed = useSnoozeStore((s) => s.isSnoozed(workItemId));
  const activeSnooze = useSnoozeStore((s) => s.getActiveSnooze(workItemId));
  const unsnoozeWorkItem = useSnoozeStore((s) => s.unsnoozeWorkItem);

  const [isEditingPoints, setIsEditingPoints] = useState(false);
  const [editPoints, setEditPoints] = useState("");
  const pointsRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isEditingPoints) pointsRef.current?.focus();
  }, [isEditingPoints]);

  // Reset editing state when sheet closes
  useEffect(() => {
    if (!open) setIsEditingPoints(false);
  }, [open]);

  const startEditingPoints = () => {
    setEditPoints(item?.points != null ? String(item.points) : "");
    setIsEditingPoints(true);
  };

  const commitPoints = () => {
    const num = parseInt(editPoints, 10);
    setWorkItemPoints(workItemId, isNaN(num) || num <= 0 ? undefined : num);
    setIsEditingPoints(false);
  };

  if (!item) return null;

  const pointsMemo = new Map<string, number>();
  const getEffectivePoints = (wi: (typeof workItems)[string]): number => itemEffectivePoints(workItems, wi.id, pointsMemo);
  const totalPoints = getEffectivePoints(item);
  const directChildrenSum = item.childrenIds.reduce((sum, cid) => {
    const child = workItems[cid];
    return sum + (child ? getEffectivePoints(child) : 0);
  }, 0);
  const isRolledUp = directChildrenSum > 0 && directChildrenSum > (item.points ?? 0);

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-4 pb-8 pt-4 rounded-t-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base truncate text-left"><IconizedTitle title={item.title} /></SheetTitle>
        </SheetHeader>

        <div className="space-y-3">
          {pointsVisible && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Story points</span>
              {isEditingPoints ? (
                <input
                  ref={pointsRef}
                  className="w-16 text-sm text-center bg-transparent border-b border-primary/40 outline-none tabular-nums"
                  value={editPoints}
                  onChange={(e) => setEditPoints(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") commitPoints();
                    if (e.key === "Escape") setIsEditingPoints(false);
                  }}
                  onBlur={commitPoints}
                />
              ) : (
                <button
                  className={`text-sm tabular-nums px-2 py-0.5 rounded hover:bg-accent transition-colors ${isRolledUp ? "text-primary font-medium" : "text-muted-foreground"}`}
                  onClick={startEditingPoints}
                  title={isRolledUp ? `Own: ${item.points ?? 0}, Rolled-up: ${directChildrenSum}` : "Tap to edit"}
                >
                  {totalPoints > 0 ? totalPoints : "—"}
                </button>
              )}
            </div>
          )}

          {ratingsVisible && item && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Rating</span>
              <StarRating
                rating={item.rating}
                label={item.title}
                onRate={(rating) => setWorkItemRating(item.id, rating)}
              />
            </div>
          )}

          {deadlinesVisible && item && (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="sheet-deadline" className="text-sm font-medium">
                Deadline
              </label>
              {/* The phone's own date picker; emptying it takes the deadline away. */}
              <input
                id="sheet-deadline"
                type="date"
                value={item.deadline ?? ""}
                onChange={(e) => setWorkItemDeadline(item.id, e.target.value || undefined)}
                className="h-9 rounded-md border bg-background px-2 text-sm"
              />
            </div>
          )}

          {labelsVisible && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Labels</span>
              <LabelPicker entityType="work_item" entityId={workItemId}>
                <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-accent">
                  <Tag className="w-3.5 h-3.5" />
                  {itemLabels.length > 0 ? (
                    <span className="flex items-center gap-1">
                      {itemLabels.map((l) => (
                        <span key={l.id} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                      ))}
                      <span className="text-xs tabular-nums">{itemLabels.length}</span>
                    </span>
                  ) : (
                    <span className="text-xs">Add labels</span>
                  )}
                </button>
              </LabelPicker>
            </div>
          )}

          {timeLoggingVisible && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Time logged</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sm text-muted-foreground"
                onClick={() => { onOpenChange(false); onOpenTimeLog(); }}
              >
                <Clock className="w-3.5 h-3.5 mr-1" />
                {itemTotalMinutes > 0 ? formatDuration(itemTotalMinutes) : "Log time"}
              </Button>
            </div>
          )}

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Respawn</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm text-muted-foreground"
              onClick={() => { onOpenChange(false); onOpenRespawn(); }}
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" />
              {item.respawnEnabled
                ? `Every ${item.respawnIntervalDays ?? 7}d`
                : "Configure"}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Hyperlinks</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm text-muted-foreground"
              onClick={() => { onOpenChange(false); onOpenHyperlinks(); }}
            >
              <Link2 className="w-3.5 h-3.5 mr-1" />
              {hyperlinkCount > 0 ? `${hyperlinkCount} link${hyperlinkCount !== 1 ? "s" : ""}` : "Manage"}
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Name</span>
            {!isNameScrambled ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sm text-muted-foreground"
                onClick={() => { onOpenChange(false); onScrambleName(); }}
              >
                <Lock className="w-3.5 h-3.5 mr-1" />
                Scramble
              </Button>
            ) : scrambledByMe ? (
              <span className="flex items-center gap-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-sm text-muted-foreground"
                  onClick={() => { onOpenChange(false); onRevealName(); }}
                >
                  Show
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-7 px-2 text-sm text-muted-foreground"
                  onClick={() => { onOpenChange(false); onUnscrambleName(); }}
                >
                  <Lock className="w-3.5 h-3.5 mr-1" />
                  Unscramble
                </Button>
              </span>
            ) : (
              <span className="flex items-center gap-1 px-2 text-sm text-muted-foreground">
                <Lock className="w-3.5 h-3.5" />
                Scrambled by someone else
              </span>
            )}
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Duplicate</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm text-muted-foreground"
              onClick={() => { onOpenChange(false); onDuplicate(); }}
            >
              <Copy className="w-3.5 h-3.5 mr-1" />
              Duplicate
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Move…</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm text-muted-foreground"
              onClick={() => { onOpenChange(false); onOpenMove(); }}
            >
              <FolderInput className="w-3.5 h-3.5 mr-1" />
              Move
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Reparent</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm text-muted-foreground"
              onClick={() => { onOpenChange(false); onOpenReparent(); }}
            >
              <GitBranch className="w-3.5 h-3.5 mr-1" />
              Reparent
            </Button>
          </div>

          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Snooze</span>
            {isSnoozed && activeSnooze ? (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sm text-muted-foreground"
                onClick={() => { onOpenChange(false); unsnoozeWorkItem(workItemId); }}
              >
                <Bell className="w-3.5 h-3.5 mr-1" />
                {new Date(activeSnooze.snoozedUntil).toLocaleString(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}
              </Button>
            ) : (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sm text-muted-foreground"
                onClick={() => { onOpenChange(false); onOpenSnooze(); }}
              >
                <BellOff className="w-3.5 h-3.5 mr-1" />
                Snooze
              </Button>
            )}
          </div>
        </div>
      </SheetContent>
    </Sheet>
  );
}

// ─── Backlog Attributes Sheet ─────────────────────────────────────────────────

interface MobileBacklogAttributesSheetProps {
  backlogId: string;
  totalPoints: number;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onOpenTimeLog: () => void;
  /** The backlog's public link, which the desktop offers in its context menu. */
  onOpenPublicLink: () => void;
}

export function MobileBacklogAttributesSheet({
  backlogId,
  totalPoints,
  open,
  onOpenChange,
  onOpenTimeLog,
  onOpenPublicLink,
}: MobileBacklogAttributesSheetProps) {
  const publicLinksEnabled = usePublicLinksEnabled();
  const isPublished = usePublishedLinksStore((s) => s.backlogs.has(backlogId)) && publicLinksEnabled;
  const backlog = useAppStore((s) => s.backlogs[backlogId]);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const orgSettings = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""] ?? DEFAULT_MOBILE_ORG_SETTINGS,
  );
  const pointsVisible = usePointsVisibleForTree(backlog?.treeId ?? null);
  const timeLoggingVisible = orgSettings.timeLoggingEnabled;
  const labelsVisible = orgSettings.labelsEnabled ?? false;

  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const backlogTotalMinutes = useMemo(() => {
    if (!timeLoggingVisible) return 0;
    return Object.values(timeEntries)
      .filter((e) => e.backlogId === backlogId && e.workItemId === null)
      .reduce((sum, e) => sum + e.durationMinutes, 0);
  }, [timeEntries, backlogId, timeLoggingVisible]);

  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const backlogLabels = useMemo(() => {
    if (!labelsVisible) return [];
    const labelIds = byEntity[`backlog:${backlogId}`] ?? [];
    return labelIds
      .map((id) => labelsMap[id])
      .filter(Boolean)
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [labelsVisible, byEntity, labelsMap, backlogId]);

  if (!backlog) return null;

  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent side="bottom" className="px-4 pb-8 pt-4 rounded-t-xl max-h-[80vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <SheetHeader className="mb-4">
          <SheetTitle className="text-base truncate text-left">{backlog.name}</SheetTitle>
        </SheetHeader>

        <div className="space-y-3">
          {pointsVisible && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Total points</span>
              <span className="text-sm tabular-nums text-muted-foreground">
                {totalPoints > 0 ? `${totalPoints} pt${totalPoints !== 1 ? "s" : ""}` : "—"}
              </span>
            </div>
          )}

          {/* An estimate for the whole backlog; the total above is the larger
              of it and the contents. Emptying the field takes it away. */}
          {pointsVisible && (
            <div className="flex items-center justify-between gap-3">
              <label htmlFor="sheet-backlog-points" className="text-sm font-medium">
                Estimate
              </label>
              <input
                id="sheet-backlog-points"
                inputMode="numeric"
                defaultValue={backlog.points ?? ""}
                placeholder="—"
                onBlur={(e) => {
                  const t = e.target.value.trim();
                  if (t === "") useAppStore.getState().setBacklogPoints(backlogId, undefined);
                  else if (/^\d+$/.test(t)) useAppStore.getState().setBacklogPoints(backlogId, Number(t));
                  else e.target.value = backlog.points != null ? String(backlog.points) : "";
                }}
                className="h-9 w-24 rounded-md border bg-background px-2 text-right text-sm tabular-nums"
              />
            </div>
          )}

          {labelsVisible && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Labels</span>
              <LabelPicker entityType="backlog" entityId={backlogId}>
                <button className="flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground transition-colors px-2 py-0.5 rounded hover:bg-accent">
                  <Tag className="w-3.5 h-3.5" />
                  {backlogLabels.length > 0 ? (
                    <span className="flex items-center gap-1">
                      {backlogLabels.map((l) => (
                        <span key={l.id} className="w-2.5 h-2.5 rounded-full" style={{ backgroundColor: l.color }} />
                      ))}
                      <span className="text-xs tabular-nums">{backlogLabels.length}</span>
                    </span>
                  ) : (
                    <span className="text-xs">Add labels</span>
                  )}
                </button>
              </LabelPicker>
            </div>
          )}

          {timeLoggingVisible && (
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium">Time logged</span>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-sm text-muted-foreground"
                onClick={() => { onOpenChange(false); onOpenTimeLog(); }}
              >
                <Clock className="w-3.5 h-3.5 mr-1" />
                {backlogTotalMinutes > 0 ? formatDuration(backlogTotalMinutes) : "Log time"}
              </Button>
            </div>
          )}

          {publicLinksEnabled && (
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium">Public link</span>
            <Button
              variant="ghost"
              size="sm"
              className="h-7 px-2 text-sm text-muted-foreground"
              onClick={() => { onOpenChange(false); onOpenPublicLink(); }}
            >
              <Globe className="w-3.5 h-3.5 mr-1" />
              {isPublished ? "Published" : "Create"}
            </Button>
          </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
