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
import { Plus, Trash2, Clock } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { supabase } from "@/integrations/supabase/client";

interface TimeLogDialogProps {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function formatDuration(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

export function parseDuration(input: string): number | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  // Try "Xh Ym" or "XhYm" format (with optional m/min suffix)
  const hm = trimmed.match(/^(\d+)\s*h\s*(\d+)(?:\s*m(?:in)?)?$/i);
  if (hm) return parseInt(hm[1], 10) * 60 + parseInt(hm[2], 10);

  // Try "Xh" format (supports decimals)
  const hOnly = trimmed.match(/^(\d+(?:\.\d+)?)\s*h$/i);
  if (hOnly) return Math.round(parseFloat(hOnly[1]) * 60);

  // Try "Xm" or "Xmin" format (supports decimals)
  const mOnly = trimmed.match(/^(\d+(?:\.\d+)?)\s*m(?:in)?$/i);
  if (mOnly) return Math.round(parseFloat(mOnly[1]));

  // Plain number: treat as hours (supports decimals, e.g. 1.5 = 1h 30m)
  const num = parseFloat(trimmed);
  if (!isNaN(num) && num > 0) return Math.round(num * 60);

  return null;
}

export function TimeLogDialog({ workItemId, open, onOpenChange }: TimeLogDialogProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const addTimeEntry = useTimeEntryStore((s) => s.addTimeEntry);
  const deleteTimeEntry = useTimeEntryStore((s) => s.deleteTimeEntry);
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const { user } = useAuth();

  const [isAdding, setIsAdding] = useState(false);
  const [durationInput, setDurationInput] = useState("");
  const [dateInput, setDateInput] = useState(() => new Date().toISOString().slice(0, 10));
  const [noteInput, setNoteInput] = useState("");
  const durationRef = useRef<HTMLInputElement>(null);

  // Cache for user display names (userId -> display name)
  const [userNames, setUserNames] = useState<Record<string, string>>({});

  const itemEntries = useMemo(() => {
    return Object.values(timeEntries)
      .filter((e) => e.workItemId === workItemId)
      .sort((a, b) => b.spentDate.localeCompare(a.spentDate) || b.createdAt.localeCompare(a.createdAt));
  }, [timeEntries, workItemId]);

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
      setTimeout(() => durationRef.current?.focus(), 0);
    }
  }, [isAdding]);

  useEffect(() => {
    if (!open) {
      setIsAdding(false);
      setDurationInput("");
      setNoteInput("");
      setDateInput(new Date().toISOString().slice(0, 10));
      return;
    }
    // Propose a duration based on time since the user's last log entry
    const allEntries = Object.values(timeEntries);
    const lastUserEntry = allEntries
      .filter((e) => e.userId === user?.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
    if (lastUserEntry) {
      const diffMinutes = Math.round((Date.now() - new Date(lastUserEntry.createdAt).getTime()) / 60000);
      if (diffMinutes > 0) {
        setDurationInput(formatDuration(diffMinutes));
      }
    }
    if (itemEntries.length === 0) {
      setIsAdding(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  if (!item) return null;

  const handleAdd = async () => {
    const minutes = parseDuration(durationInput);
    if (!minutes || minutes <= 0) {
      toast({ title: "Invalid duration", description: 'Enter a value like "1.5", "30m", "1h", or "1h 30m".', variant: "destructive" });
      return;
    }
    if (!activeOrgId || !user?.id) return;

    await addTimeEntry({
      organizationId: activeOrgId,
      userId: user.id,
      workItemId,
      durationMinutes: minutes,
      spentDate: dateInput,
      note: noteInput.trim() || null,
    });

    setDurationInput("");
    setNoteInput("");
    setDateInput(new Date().toISOString().slice(0, 10));
    setIsAdding(false);
  };

  const canDelete = (entry: TimeEntry) => entry.userId === user?.id;

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
        <div className="text-sm text-muted-foreground mb-2 truncate" title={item.title}>
          {item.title}
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
              className="flex items-center gap-2 p-2 rounded-md border hover:bg-muted/30 transition-colors group"
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
                  onClick={() => deleteTimeEntry(entry.id)}
                  title="Delete"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              )}
            </div>
          ))}
        </div>

        {/* Add new entry form */}
        {isAdding ? (
          <div className="space-y-2 p-2 rounded-md border border-dashed bg-muted/20 mt-2">
            <div className="grid grid-cols-2 gap-2">
              <div className="space-y-1">
                <Label className="text-xs">Duration</Label>
                <Input
                  ref={durationRef}
                  value={durationInput}
                  onChange={(e) => setDurationInput(e.target.value)}
                  placeholder='e.g. "1.5" or "1h 30m"'
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
                    if (e.key === "Escape") setIsAdding(false);
                  }}
                />
              </div>
              <div className="space-y-1">
                <Label className="text-xs">Date</Label>
                <Input
                  type="date"
                  value={dateInput}
                  onChange={(e) => setDateInput(e.target.value)}
                  className="h-8 text-sm"
                  onKeyDown={(e) => {
                    if (e.key === "Enter") handleAdd();
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
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setIsAdding(false);
                }}
              />
            </div>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={!durationInput.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Log Time
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Log time
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
