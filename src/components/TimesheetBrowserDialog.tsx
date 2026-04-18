import { useState, useEffect, useMemo, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Check, Clock, Download, Trash2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTimeEntryStore, TimeEntry } from "@/store/timeEntryStore";
import { useAppStore } from "@/store/appStore";
import { useAuth } from "@/hooks/useAuth";
import { supabase } from "@/integrations/supabase/client";
import { formatDuration, parseDuration } from "@/components/TimeLogDialog";
import { toast } from "@/hooks/use-toast";

interface TimesheetBrowserDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  orgName: string;
}

function escapeCsvField(value: string): string {
  if (value.includes(",") || value.includes('"') || value.includes("\n")) {
    return `"${value.replace(/"/g, '""')}"`;
  }
  return value;
}

function exportToCsv(
  entries: TimeEntry[],
  userNames: Record<string, string>,
  workItems: ReturnType<typeof useAppStore.getState>["workItems"],
  backlogs: ReturnType<typeof useAppStore.getState>["backlogs"],
  orgName: string,
): void {
  const headers = ["Date", "User", "Work Item / Backlog", "Duration (min)", "Duration", "Note"];

  const rows = entries.map((entry) => {
    const userName = userNames[entry.userId] ?? `Unknown (${entry.userId.slice(0, 8)})`;

    let subject = "(unlinked)";
    if (entry.workItemId && workItems[entry.workItemId]) {
      subject = workItems[entry.workItemId].title;
    } else if (entry.backlogId && backlogs[entry.backlogId]) {
      subject = backlogs[entry.backlogId].name;
    }

    const h = Math.floor(entry.durationMinutes / 60);
    const m = entry.durationMinutes % 60;
    const durationFormatted = h > 0 ? (m > 0 ? `${h}h ${m}m` : `${h}h`) : `${m}m`;

    return [
      entry.spentDate,
      userName,
      subject,
      String(entry.durationMinutes),
      durationFormatted,
      entry.note ?? "",
    ].map(escapeCsvField);
  });

  const csvContent = [headers.map(escapeCsvField), ...rows]
    .map((r) => r.join(","))
    .join("\n");

  const blob = new Blob(["\uFEFF", csvContent], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  const safeOrgName = orgName
    .replace(/[^a-zA-Z0-9-]/g, "_")
    .replace(/_+/g, "_")
    .replace(/^_|_$/g, "");
  const date = new Date().toISOString().slice(0, 10);
  a.href = url;
  a.download = `timesheets_${safeOrgName}_${date}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function TimesheetBrowserDialog({
  open,
  onOpenChange,
  orgName,
}: TimesheetBrowserDialogProps) {
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const updateTimeEntry = useTimeEntryStore((s) => s.updateTimeEntry);
  const deleteTimeEntry = useTimeEntryStore((s) => s.deleteTimeEntry);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const { user } = useAuth();

  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [filterUser, setFilterUser] = useState<string>("__all__");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Edit state
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDurationInput, setEditDurationInput] = useState("");
  const [editDateInput, setEditDateInput] = useState("");
  const [editNoteInput, setEditNoteInput] = useState("");
  const editDurationRef = useRef<HTMLInputElement>(null);

  // Fetch user display names when dialog opens
  useEffect(() => {
    if (!open) return;
    const allEntries = Object.values(timeEntries);
    const userIds = [...new Set(allEntries.map((e) => e.userId))];
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
  }, [open, timeEntries, userNames]);

  // Focus duration input when edit mode activates
  useEffect(() => {
    if (editingEntryId) {
      setTimeout(() => editDurationRef.current?.focus(), 0);
    }
  }, [editingEntryId]);

  // Sorted list of all entries (latest first)
  const allEntriesSorted = useMemo(
    () =>
      Object.values(timeEntries).sort(
        (a, b) =>
          b.spentDate.localeCompare(a.spentDate) ||
          b.createdAt.localeCompare(a.createdAt),
      ),
    [timeEntries],
  );

  // Unique user IDs present in entries
  const uniqueUserIds = useMemo(
    () => [...new Set(allEntriesSorted.map((e) => e.userId))],
    [allEntriesSorted],
  );

  // Apply filters
  const filteredEntries = useMemo(() => {
    return allEntriesSorted.filter((entry) => {
      if (filterUser !== "__all__" && entry.userId !== filterUser) return false;
      if (filterDateFrom && entry.spentDate < filterDateFrom) return false;
      if (filterDateTo && entry.spentDate > filterDateTo) return false;
      return true;
    });
  }, [allEntriesSorted, filterUser, filterDateFrom, filterDateTo]);

  const totalMinutes = useMemo(
    () => filteredEntries.reduce((sum, e) => sum + e.durationMinutes, 0),
    [filteredEntries],
  );

  const handleExportCsv = () => {
    try {
      exportToCsv(filteredEntries, userNames, workItems, backlogs, orgName);
    } catch (err: unknown) {
      toast({
        title: "Export failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    }
  };

  const getSubject = (entry: TimeEntry): string => {
    if (entry.workItemId && workItems[entry.workItemId]) {
      return workItems[entry.workItemId].title;
    }
    if (entry.backlogId && backlogs[entry.backlogId]) {
      return backlogs[entry.backlogId].name;
    }
    return "(unlinked)";
  };

  const canModify = (entry: TimeEntry) => entry.userId === user?.id;

  const startEditing = (entry: TimeEntry) => {
    setEditingEntryId(entry.id);
    setEditDurationInput(formatDuration(entry.durationMinutes));
    setEditDateInput(entry.spentDate);
    setEditNoteInput(entry.note ?? "");
  };

  const cancelEditing = () => setEditingEntryId(null);

  const handleSaveEdit = async () => {
    if (!editingEntryId) return;
    const minutes = parseDuration(editDurationInput);
    if (!minutes || minutes <= 0) {
      toast({ title: "Invalid duration", description: 'Enter a value like "1.5", "30m", "1h", or "1h 30m".', variant: "destructive" });
      return;
    }
    await updateTimeEntry(editingEntryId, {
      durationMinutes: minutes,
      spentDate: editDateInput,
      note: editNoteInput.trim() || null,
    });
    setEditingEntryId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4" /> Logged Time
          </DialogTitle>
        </DialogHeader>

        {/* Filters */}
        <div className="flex flex-wrap items-end gap-3">
          <div className="space-y-1">
            <Label className="text-xs">User</Label>
            <Select value={filterUser} onValueChange={setFilterUser}>
              <SelectTrigger className="w-44 h-8 text-sm">
                <SelectValue placeholder="All users" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="__all__">All users</SelectItem>
                {uniqueUserIds.map((uid) => (
                  <SelectItem key={uid} value={uid}>
                    {userNames[uid] ?? uid.slice(0, 8)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-xs">From</Label>
            <Input
              type="date"
              value={filterDateFrom}
              onChange={(e) => setFilterDateFrom(e.target.value)}
              className="h-8 text-sm w-36"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => setFilterDateTo(e.target.value)}
              className="h-8 text-sm w-36"
            />
          </div>
          {(filterUser !== "__all__" || filterDateFrom || filterDateTo) && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                setFilterUser("__all__");
                setFilterDateFrom("");
                setFilterDateTo("");
              }}
            >
              Clear filters
            </Button>
          )}
          <div className="ml-auto flex items-center gap-3">
            <span className="text-xs text-muted-foreground">
              {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"} —{" "}
              <strong className="text-foreground">{formatDuration(totalMinutes)}</strong> total
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={handleExportCsv}
              disabled={filteredEntries.length === 0}
            >
              <Download className="w-3.5 h-3.5 mr-1" /> Export CSV
            </Button>
          </div>
        </div>

        {/* Table */}
        <ScrollArea className="h-[420px] rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-24 text-right">Duration</TableHead>
                <TableHead className="w-28">Date</TableHead>
                <TableHead className="w-40">User</TableHead>
                <TableHead>Work Item / Backlog</TableHead>
                <TableHead>Note</TableHead>
                <TableHead className="w-16" />
              </TableRow>
            </TableHeader>
            <TableBody>
              {filteredEntries.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={6} className="text-center text-muted-foreground py-8">
                    No time entries found.
                  </TableCell>
                </TableRow>
              ) : (
                filteredEntries.map((entry) =>
                  editingEntryId === entry.id ? (
                    /* ── Inline edit row ── */
                    <TableRow key={entry.id} className="bg-muted/20">
                      <TableCell colSpan={6} className="py-2 px-3">
                        <div className="flex flex-wrap items-end gap-2">
                          <div className="space-y-1">
                            <Label className="text-xs">Duration</Label>
                            <Input
                              ref={editDurationRef}
                              value={editDurationInput}
                              onChange={(e) => setEditDurationInput(e.target.value)}
                              placeholder='e.g. "1.5", "1h 30m"'
                              className="h-8 text-sm w-32"
                              onKeyDown={async (e) => {
                                if (e.key === "Enter") await handleSaveEdit();
                                if (e.key === "Escape") cancelEditing();
                              }}
                            />
                          </div>
                          <div className="space-y-1">
                            <Label className="text-xs">Date</Label>
                            <Input
                              type="date"
                              value={editDateInput}
                              onChange={(e) => setEditDateInput(e.target.value)}
                              className="h-8 text-sm w-36"
                              onKeyDown={async (e) => {
                                if (e.key === "Enter") await handleSaveEdit();
                                if (e.key === "Escape") cancelEditing();
                              }}
                            />
                          </div>
                          <div className="space-y-1 flex-1 min-w-[140px]">
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
                          <div className="flex gap-1 pb-0.5">
                            <Button
                              variant="ghost"
                              size="icon"
                              className="h-8 w-8 text-muted-foreground hover:text-foreground"
                              onClick={cancelEditing}
                              title="Cancel"
                            >
                              <X className="w-4 h-4" />
                            </Button>
                            <Button
                              size="icon"
                              className="h-8 w-8"
                              onClick={handleSaveEdit}
                              disabled={!editDurationInput.trim() || (parseDuration(editDurationInput) ?? 0) <= 0}
                              title="Save"
                            >
                              <Check className="w-4 h-4" />
                            </Button>
                          </div>
                        </div>
                      </TableCell>
                    </TableRow>
                  ) : (
                    /* ── Read-only row ── */
                    <TableRow
                      key={entry.id}
                      className={cn("group", canModify(entry) && "cursor-pointer hover:bg-muted/40")}
                      onClick={() => canModify(entry) && startEditing(entry)}
                      title={canModify(entry) ? "Click to edit" : undefined}
                    >
                      <TableCell className="text-xs tabular-nums text-right">
                        {formatDuration(entry.durationMinutes)}
                      </TableCell>
                      <TableCell className="text-xs tabular-nums">{entry.spentDate}</TableCell>
                      <TableCell className="text-xs truncate max-w-[160px]" title={userNames[entry.userId]}>
                        {userNames[entry.userId] ?? entry.userId.slice(0, 8)}
                      </TableCell>
                      <TableCell className="text-xs truncate max-w-[200px]" title={getSubject(entry)}>
                        {getSubject(entry)}
                      </TableCell>
                      <TableCell className="text-xs text-muted-foreground truncate max-w-[200px]" title={entry.note ?? ""}>
                        {entry.note ?? ""}
                      </TableCell>
                      <TableCell className="text-right pr-2">
                        {canModify(entry) && (
                          <span className="inline-flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                            <button
                              className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                              onClick={(e) => { e.stopPropagation(); deleteTimeEntry(entry.id); }}
                              title="Delete"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </span>
                        )}
                      </TableCell>
                    </TableRow>
                  )
                )
              )}
            </TableBody>
          </Table>
        </ScrollArea>
      </DialogContent>
    </Dialog>
  );
}