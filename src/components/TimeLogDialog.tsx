import { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/appStore";
import { useTimeEntryStore, TimeEntry } from "@/store/timeEntryStore";
import { useOrgStore } from "@/store/orgStore";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Plus, Trash2, Clock, RotateCcw } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration } from "@/lib/formatDuration";
import { parseDuration } from "@/lib/parseDuration";
import { DurationReading } from "@/components/DurationReading";
import { presetRange } from "@/lib/timesheetDefaults";

interface TimeLogDialogProps {
  workItemId?: string;
  backlogId?: string;
  treeId?: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}


export { formatDuration };



const CLOCK_RESET_KEY = (userId: string) => `timelog_clock_reset_${userId}`;

/**
 * Today in the user's own time zone. toISOString() gives the UTC date, so in
 * Finland anything logged between midnight and three in the morning went in
 * dated the day before — and was missing from a report that opens on today.
 */
const localToday = () => presetRange("today").from;

export function TimeLogDialog({ workItemId, backlogId, treeId, open, onOpenChange }: TimeLogDialogProps) {
  const item = useAppStore((s) => workItemId ? s.workItems[workItemId] : null);
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const backlog = useAppStore((s) => backlogId ? s.backlogs[backlogId] : null);
  const tree = useAppStore((s) => treeId ? s.backlogTrees[treeId] : null);
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const addTimeEntry = useTimeEntryStore((s) => s.addTimeEntry);
  const updateTimeEntry = useTimeEntryStore((s) => s.updateTimeEntry);
  const deleteTimeEntry = useTimeEntryStore((s) => s.deleteTimeEntry);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { user } = useAuth();

  const [isAdding, setIsAdding] = useState(false);
  const [durationInput, setDurationInput] = useState("");
  const [dateInput, setDateInput] = useState(localToday);
  const [noteInput, setNoteInput] = useState("");
  const durationRef = useRef<HTMLInputElement>(null);
  const addFormRef = useRef<HTMLDivElement>(null);
  // Set while an entry is being saved. Enter and the Save button both add, and
  // nothing stopped the second while the first was still on its way: the same
  // entry went in twice, a second apart.
  const addingRef = useRef(false);

  // Edit state for existing entries
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDurationInput, setEditDurationInput] = useState("");
  const [editDateInput, setEditDateInput] = useState("");
  const [editNoteInput, setEditNoteInput] = useState("");
  const editDurationRef = useRef<HTMLInputElement>(null);

  // Cache for user display names (userId -> display name)
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  const itemEntries = useMemo(() => {
    return Object.values(timeEntries)
      .filter((e) => {
        if (workItemId) return e.workItemId === workItemId;
        if (backlogId) return e.backlogId === backlogId && e.workItemId === null;
        if (treeId) return e.treeId === treeId && e.workItemId === null && e.backlogId === null;
        return false;
      })
      .sort((a, b) => b.spentDate.localeCompare(a.spentDate) || b.createdAt.localeCompare(a.createdAt));
  }, [timeEntries, workItemId, backlogId, treeId]);


  const totalMinutes = useMemo(
    () => itemEntries.reduce((sum, e) => sum + e.durationMinutes, 0),
    [itemEntries],
  );

  // Fetch display names for all users that appear in entries
  useEffect(() => {
    if (!open) return;
    const userIds = [...new Set(itemEntries.map((e) => e.userId))];
    const missing = userIds.filter((id) => !userNames[id]);
    if (missing.length === 0) return;

    supabase
      .from("profiles")
      .select("id, email, full_name")
      .in("id", missing)
      .then(({ data }) => {
        if (!data) return;
        const newNames: Record<string, string> = {};
        for (const p of data) {
          newNames[p.id] = p.full_name || p.email || p.id;
        }
        setUserNames((prev) => ({ ...prev, ...newNames }));
      });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, itemEntries]);

  useEffect(() => {
    if (isAdding) {
      setTimeout(() => {
        durationRef.current?.focus();
        addFormRef.current?.scrollIntoView({ behavior: "smooth", block: "nearest" });
      }, 0);
    }
  }, [isAdding]);

  useEffect(() => {
    if (editingEntryId) {
      setTimeout(() => editDurationRef.current?.focus(), 0);
    }
  }, [editingEntryId]);

  useEffect(() => {
    if (!open) {
      setIsAdding(false);
      setDurationInput("");
      setNoteInput("");
      setDateInput(localToday());
      setEditingEntryId(null);
      return;
    }
    // Determine the reference time: the later of the user's last log entry and any
    // stored clock-reset timestamp.
    const clockResetStr = user?.id ? localStorage.getItem(CLOCK_RESET_KEY(user.id)) : null;
    const clockResetTime = clockResetStr ? new Date(clockResetStr).getTime() : 0;

    const allEntries = Object.values(timeEntries);
    const lastUserEntry = allEntries
      .filter((e) => e.userId === user?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];

    const lastEntryTime = lastUserEntry ? new Date(lastUserEntry.createdAt).getTime() : 0;
    const refTime = Math.max(lastEntryTime, clockResetTime);

    if (refTime > 0) {
      const diffMinutes = Math.round((Date.now() - refTime) / 60000);
      // Only propose a non-zero default when elapsed time is within 8 hours.
      if (diffMinutes > 0 && diffMinutes <= 8 * 60) {
        setDurationInput(formatDuration(diffMinutes));
      } else {
        setDurationInput("");
      }
    }
    setIsAdding(true);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!item && !backlog && !tree) return null;
  const displayTitle = item?.title ?? backlog?.name ?? tree?.name ?? "";

  const handleAdd = async (): Promise<boolean> => {
    if (addingRef.current) return false;
    const minutes = parseDuration(durationInput);
    if (!minutes || minutes <= 0) {
      toast({ title: "Invalid duration", description: 'Enter minutes like "45", hours like "1.5", or "1h 30m".', variant: "destructive" });
      return false;
    }
    if (!activeOrgId || !user?.id) return false;

    addingRef.current = true;
    try {
      await addTimeEntry({
        organizationId: activeOrgId,
        userId: user.id,
        workItemId: workItemId ?? null,
        backlogId: backlogId ?? null,
        treeId: treeId ?? null,
        durationMinutes: minutes,
        spentDate: dateInput,
        note: noteInput.trim() || null,
      });

      if (workItemId && item?.status === "not_started") {
        setWorkItemStatus(workItemId, "in_progress");
      }

      setDurationInput("");
      setNoteInput("");
      setDateInput(localToday());
      setIsAdding(false);
      return true;
    } finally {
      addingRef.current = false;
    }
  };

  const canDelete = (entry: TimeEntry) => entry.userId === user?.id;

  const startEditing = (entry: TimeEntry) => {
    setEditingEntryId(entry.id);
    setEditDurationInput(formatDuration(entry.durationMinutes));
    setEditDateInput(entry.spentDate);
    setEditNoteInput(entry.note ?? "");
  };

  const cancelEditing = () => setEditingEntryId(null);

  const handleSaveEdit = async (): Promise<boolean> => {
    if (!editingEntryId) return false;
    const minutes = parseDuration(editDurationInput);
    if (!minutes || minutes <= 0) {
      toast({ title: "Invalid duration", description: 'Enter minutes like "45", hours like "1.5", or "1h 30m".', variant: "destructive" });
      return false;
    }
    await updateTimeEntry(editingEntryId, {
      durationMinutes: minutes,
      spentDate: editDateInput,
      note: editNoteInput.trim() || null,
    });
    setEditingEntryId(null);
    return true;
  };

  const handleResetClock = () => {
    if (user?.id) {
      localStorage.setItem(CLOCK_RESET_KEY(user.id), new Date().toISOString());
    }
    setDurationInput("");
    setTimeout(() => durationRef.current?.focus(), 0);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4" /> Time Log
          </DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-2 truncate" title={displayTitle}>
          {displayTitle}
        </div>

        {totalMinutes > 0 && (
          <div className="text-xs text-muted-foreground mb-2">
            Total: <strong className="text-foreground">{formatDuration(totalMinutes)}</strong>
          </div>
        )}

        {/* Existing entries */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {itemEntries.length === 0 && !isAdding && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No time logged yet.
            </p>
          )}
          {itemEntries.map((entry) => (
            <div
              key={entry.id}
              className="rounded-md border transition-colors group"
            >
              {editingEntryId === entry.id ? (
                /* ── Inline edit form ── */
                <div className="space-y-2 p-2 bg-muted/20">
                  <div className="grid grid-cols-2 gap-2">
                    <div className="space-y-1">
                      <Label className="text-xs">Duration</Label>
                      <Input
                        ref={editDurationRef}
                        value={editDurationInput}
                        onChange={(e) => setEditDurationInput(e.target.value)}
                        placeholder='e.g. "45", "1.5" or "1h 30m"'
                        className="h-8 text-sm"
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") await handleSaveEdit();
                          if (e.key === "Escape") cancelEditing();
                        }}
                      />
                      <DurationReading input={editDurationInput} />
                    </div>
                    <div className="space-y-1">
                      <Label className="text-xs">Date</Label>
                      <Input
                        type="date"
                        value={editDateInput}
                        onChange={(e) => setEditDateInput(e.target.value)}
                        className="h-8 text-sm"
                        onKeyDown={async (e) => {
                          if (e.key === "Enter") await handleSaveEdit();
                          if (e.key === "Escape") cancelEditing();
                        }}
                      />
                    </div>
                  </div>
                  <div className="space-y-1">
                    <Label className="text-xs">Note (optional)</Label>
                    <Input
                      value={editNoteInput}
                      onChange={(e) => setEditNoteInput(e.target.value)}
                      placeholder="What did you work on?"
                      className="h-8 text-sm"
                      onKeyDown={async (e) => {
                        if (e.key === "Enter") await handleSaveEdit();
                        if (e.key === "Escape") cancelEditing();
                      }}
                    />
                  </div>
                  <div className="flex justify-end gap-1">
                    <Button variant="ghost" size="sm" onClick={cancelEditing}>
                      Cancel
                    </Button>
                    <Button size="sm" onClick={handleSaveEdit} disabled={!editDurationInput.trim() || (parseDuration(editDurationInput) ?? 0) <= 0}>
                      Save
                    </Button>
                  </div>
                </div>
              ) : (
                /* ── Read-only entry row ── */
                <div
                  className={`flex items-center gap-2 p-2 hover:bg-muted/30 ${canDelete(entry) ? "cursor-pointer" : ""}`}
                  onClick={() => canDelete(entry) && startEditing(entry)}
                  title={canDelete(entry) ? "Click to edit" : undefined}
                >
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2 text-sm">
                      <span className="font-medium tabular-nums">{formatDuration(entry.durationMinutes)}</span>
                      <span className="text-muted-foreground text-xs">{entry.spentDate}</span>
                    </div>
                    {entry.note && (
                      <p className="text-xs text-muted-foreground mt-0.5 truncate" title={entry.note}>
                        {entry.note}
                      </p>
                    )}
                    <p className="text-[10px] text-muted-foreground/70 mt-0.5">
                      {userNames[entry.userId] ?? entry.userId.slice(0, 8)}
                    </p>
                  </div>
                  {canDelete(entry) && (
                    <button
                      className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors opacity-0 group-hover:opacity-100 shrink-0"
                      onClick={(e) => { e.stopPropagation(); deleteTimeEntry(entry.id); }}
                      title="Delete"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
              )}
            </div>
          ))}
        </div>

        {/* Add new entry form */}
        {isAdding ? (
          <div ref={addFormRef} className="space-y-2 p-2 rounded-md border border-dashed bg-muted/20 mt-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Duration</Label>
                <Input
                  ref={durationRef}
                  value={durationInput}
                  onChange={(e) => setDurationInput(e.target.value)}
                  placeholder='e.g. "45", "1.5" or "1h 30m"'
                  className="h-8 text-sm"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && await handleAdd()) onOpenChange(false);
                    if (e.key === "Escape") setIsAdding(false);
                  }}
                />
                <DurationReading input={durationInput} />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="h-8 text-sm"
                  onKeyDown={async (e) => {
                    if (e.key === "Enter" && await handleAdd()) onOpenChange(false);
                    if (e.key === "Escape") setIsAdding(false);
                  }}
                />
              </div>
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Note (optional)</Label>
              <Input
                value={noteInput}
                onChange={(e) => setNoteInput(e.target.value)}
                placeholder="What did you work on?"
                className="h-8 text-sm"
                onKeyDown={async (e) => {
                  if (e.key === "Enter" && await handleAdd()) onOpenChange(false);
                  if (e.key === "Escape") setIsAdding(false);
                }}
              />
            </div>
            <div className="flex justify-between gap-1">
              <Button
                variant="ghost"
                size="sm"
                onClick={handleResetClock}
                title="Reset clock – clears elapsed time and sets default to zero"
              >
                <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset clock
              </Button>
              <div className="flex gap-1">
                <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
                  Cancel
                </Button>
                <Button size="sm" onClick={async () => { if (await handleAdd()) onOpenChange(false); }} disabled={!durationInput.trim()}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Log Time
                </Button>
              </div>
            </div>
          </div>
        ) : (
          <div className="flex gap-2 mt-2">
            <Button
              variant="outline"
              size="sm"
              className="flex-1"
              onClick={() => setIsAdding(true)}
            >
              <Plus className="w-3.5 h-3.5 mr-1" /> Log time
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={handleResetClock}
              title="Reset clock – clears elapsed time and sets default to zero"
            >
              <RotateCcw className="w-3.5 h-3.5 mr-1" /> Reset clock
            </Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
