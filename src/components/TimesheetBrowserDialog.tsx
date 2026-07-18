import { useState, useEffect, useMemo, useRef, Fragment } from "react";
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
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { ArrowRightLeft, Check, ChevronDown, ChevronRight, Clock, Download, Trash2, X } from "lucide-react";
import { Checkbox } from "@/components/ui/checkbox";
import { MoveTimeDialog } from "@/components/MoveTimeDialog";
import { cn } from "@/lib/utils";
import { useTimeEntryStore, TimeEntry } from "@/store/timeEntryStore";
import { useAppStore } from "@/store/appStore";
import { WorkItem, Backlog, BacklogTree } from "@/types/models";
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
    } else if (entry.treeId) {
      subject = `Tree`;
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

// ── Summary grouping ──────────────────────────────────────────────────────────

type GroupDimension = "tree" | "backlog" | "item" | "user" | "date";

const ALL_DIMS: GroupDimension[] = ["tree", "backlog", "item", "user", "date"];

const DIMENSION_LABELS: Record<GroupDimension, string> = {
  tree: "Tree",
  backlog: "Backlog",
  item: "Work Item",
  user: "Person",
  date: "Date",
};

function getEntryGroupKey(
  entry: TimeEntry,
  dim: GroupDimension,
  workItems: Record<string, WorkItem>,
  backlogs: Record<string, Backlog>,
): string {
  switch (dim) {
    case "date":
      return entry.spentDate;
    case "user":
      return entry.userId;
    case "item":
      return entry.workItemId ?? "__none__";
    case "backlog": {
      if (entry.backlogId) return entry.backlogId;
      if (entry.workItemId) {
        const wi = workItems[entry.workItemId];
        if (wi) {
          const blIds = Object.values(wi.backlogAssignments);
          if (blIds.length === 1) return blIds[0];
          if (blIds.length > 1) return "__multiple__";
        }
      }
      return "__none__";
    }
    case "tree": {
      if (entry.treeId) return entry.treeId;
      let blId = entry.backlogId;
      if (!blId && entry.workItemId) {
        const wi = workItems[entry.workItemId];
        if (wi) {
          const blIds = Object.values(wi.backlogAssignments);
          if (blIds.length === 1) blId = blIds[0];
          else if (blIds.length > 1) return "__multiple__";
        }
      }
      if (blId && backlogs[blId]) return backlogs[blId].treeId;
      return "__none__";
    }
  }
}

function getGroupLabel(
  key: string,
  dim: GroupDimension,
  workItems: Record<string, WorkItem>,
  backlogs: Record<string, Backlog>,
  backlogTrees: Record<string, BacklogTree>,
  userNames: Record<string, string>,
): string {
  if (key === "__none__") return "(none)";
  if (key === "__multiple__") return "(multiple)";
  switch (dim) {
    case "date": return key;
    case "user": return userNames[key] ?? key.slice(0, 8);
    case "item": return workItems[key]?.title ?? "(deleted)";
    case "backlog": return backlogs[key]?.name ?? "(deleted)";
    case "tree": return backlogTrees[key]?.name ?? "(deleted)";
  }
}

interface SummaryGroupRowsProps {
  entries: TimeEntry[];
  dims: GroupDimension[];
  depth: number;
  path: string;
  expandedPaths: Set<string>;
  onToggleExpand: (path: string) => void;
  workItems: Record<string, WorkItem>;
  backlogs: Record<string, Backlog>;
  backlogTrees: Record<string, BacklogTree>;
  userNames: Record<string, string>;
}

function SummaryGroupRows({
  entries,
  dims,
  depth,
  path,
  expandedPaths,
  onToggleExpand,
  workItems,
  backlogs,
  backlogTrees,
  userNames,
}: SummaryGroupRowsProps) {
  if (dims.length === 0 || entries.length === 0) return null;

  const [dim, ...rest] = dims;

  const groups = new Map<string, TimeEntry[]>();
  for (const entry of entries) {
    const key = getEntryGroupKey(entry, dim, workItems, backlogs);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(entry);
  }

  const sortedKeys = [...groups.keys()].sort((a, b) => {
    if (a === "__none__" || a === "__multiple__") return 1;
    if (b === "__none__" || b === "__multiple__") return -1;
    if (dim === "date") return b.localeCompare(a);
    const la = getGroupLabel(a, dim, workItems, backlogs, backlogTrees, userNames);
    const lb = getGroupLabel(b, dim, workItems, backlogs, backlogTrees, userNames);
    return la.localeCompare(lb);
  });

  return (
    <>
      {sortedKeys.map((key) => {
        const groupEntries = groups.get(key)!;
        const total = groupEntries.reduce((sum, e) => sum + e.durationMinutes, 0);
        const label = getGroupLabel(key, dim, workItems, backlogs, backlogTrees, userNames);
        const groupPath = path ? `${path}||${dim}:${key}` : `${dim}:${key}`;
        const isExpanded = expandedPaths.has(groupPath);
        const hasChildren = rest.length > 0;

        return (
          <Fragment key={groupPath}>
            <TableRow
              className={cn(
                depth === 0 ? "bg-muted/10" : "",
                hasChildren && "cursor-pointer hover:bg-muted/30",
                !hasChildren && "hover:bg-muted/10",
              )}
              onClick={() => hasChildren && onToggleExpand(groupPath)}
            >
              <TableCell
                className="text-xs py-1.5"
                style={{ paddingLeft: `${12 + depth * 20}px` }}
              >
                <span className="flex items-center gap-1.5">
                  {hasChildren ? (
                    isExpanded
                      ? <ChevronDown className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                      : <ChevronRight className="w-3 h-3 flex-shrink-0 text-muted-foreground" />
                  ) : (
                    <span className="w-3 h-3 flex-shrink-0" />
                  )}
                  <span className={cn(depth === 0 ? "font-medium" : "")}>{label}</span>
                  <span className="text-muted-foreground text-[10px]">({groupEntries.length})</span>
                </span>
              </TableCell>
              <TableCell className="text-xs tabular-nums text-right pr-4 py-1.5 font-medium">
                {formatDuration(total)}
              </TableCell>
            </TableRow>
            {hasChildren && isExpanded && (
              <SummaryGroupRows
                entries={groupEntries}
                dims={rest}
                depth={depth + 1}
                path={groupPath}
                expandedPaths={expandedPaths}
                onToggleExpand={onToggleExpand}
                workItems={workItems}
                backlogs={backlogs}
                backlogTrees={backlogTrees}
                userNames={userNames}
              />
            )}
          </Fragment>
        );
      })}
    </>
  );
}

// ─────────────────────────────────────────────────────────────────────────────

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
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const { user } = useAuth();

  const [userNames, setUserNames] = useState<Record<string, string>>({});
  const [filterUser, setFilterUser] = useState<string>("__all__");
  const [filterDateFrom, setFilterDateFrom] = useState("");
  const [filterDateTo, setFilterDateTo] = useState("");

  // Summary tab state
  const [activeTab, setActiveTab] = useState<"entries" | "summary">("entries");
  const [groupDims, setGroupDims] = useState<GroupDimension[]>(["date"]);
  const [expandedPaths, setExpandedPaths] = useState<Set<string>>(new Set());

  // Edit state
  const [editingEntryId, setEditingEntryId] = useState<string | null>(null);
  const [editDurationInput, setEditDurationInput] = useState("");
  const [editDateInput, setEditDateInput] = useState("");
  const [editNoteInput, setEditNoteInput] = useState("");
  const editDurationRef = useRef<HTMLInputElement>(null);

  // Selection for Move
  const [selectedEntryIds, setSelectedEntryIds] = useState<Set<string>>(new Set());
  const [moveOpen, setMoveOpen] = useState(false);

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

  // Auto-expand top-level groups when dimensions or filtered entries change
  useEffect(() => {
    if (groupDims.length === 0) {
      setExpandedPaths(new Set());
      return;
    }
    const dim = groupDims[0];
    const topKeys = new Set<string>();
    for (const entry of filteredEntries) {
      const key = getEntryGroupKey(entry, dim, workItems, backlogs);
      topKeys.add(`${dim}:${key}`);
    }
    setExpandedPaths(topKeys);
  }, [groupDims, filteredEntries, workItems, backlogs]);

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
    if (entry.treeId && backlogTrees[entry.treeId]) {
      return `${backlogTrees[entry.treeId].name} (tree)`;
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

  const toggleGroupDim = (dim: GroupDimension) => {
    setGroupDims((prev) => {
      const next = prev.includes(dim) ? prev.filter((d) => d !== dim) : [...prev, dim];
      // Keep dims in the fixed ALL_DIMS order so toggling off/on doesn't change position
      return next.sort((a, b) => ALL_DIMS.indexOf(a) - ALL_DIMS.indexOf(b));
    });
  };

  const toggleExpand = (path: string) => {
    setExpandedPaths((prev) => {
      const next = new Set(prev);
      if (next.has(path)) next.delete(path);
      else next.add(path);
      return next;
    });
  };

  const applyPreset = (preset: "today" | "week" | "month" | "all") => {
    const today = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    const fmt = (d: Date) =>
      `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    if (preset === "today") {
      const t = fmt(today);
      setFilterDateFrom(t);
      setFilterDateTo(t);
    } else if (preset === "week") {
      const dow = today.getDay(); // 0=Sun
      const monday = new Date(today);
      monday.setDate(today.getDate() - ((dow + 6) % 7));
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      setFilterDateFrom(fmt(monday));
      setFilterDateTo(fmt(sunday));
    } else if (preset === "month") {
      const first = new Date(today.getFullYear(), today.getMonth(), 1);
      const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
      setFilterDateFrom(fmt(first));
      setFilterDateTo(fmt(last));
    } else {
      setFilterDateFrom("");
      setFilterDateTo("");
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-4xl w-full p-4 sm:p-6" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Clock className="w-4 h-4" /> Logged Time
          </DialogTitle>
        </DialogHeader>

        {/* Shared Filters */}
        <div className="flex flex-wrap items-end gap-2">
          <div className="space-y-1">
            <Label className="text-xs">Period</Label>
            <div className="flex gap-1">
              {(
                [
                  { id: "today", label: "Today", shortLabel: "Today" },
                  { id: "week", label: "This week", shortLabel: "Week" },
                  { id: "month", label: "This month", shortLabel: "Month" },
                  { id: "all", label: "All time", shortLabel: "All" },
                ] as const
              ).map(({ id, label, shortLabel }) => (
                <Button
                  key={id}
                  variant="outline"
                  size="sm"
                  className="h-8 text-xs px-2"
                  onClick={() => applyPreset(id)}
                >
                  <span className="sm:hidden">{shortLabel}</span>
                  <span className="hidden sm:inline">{label}</span>
                </Button>
              ))}
            </div>
          </div>
          <div className="space-y-1 min-w-0">
            <Label className="text-xs">User</Label>
            <Select value={filterUser} onValueChange={setFilterUser}>
              <SelectTrigger className="w-36 sm:w-44 h-8 text-sm">
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
              onChange={(e) => {
                const val = e.target.value;
                setFilterDateFrom(val);
                if (filterDateTo && val > filterDateTo) setFilterDateTo(val);
              }}
              className="h-8 text-sm w-32 sm:w-36"
            />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">To</Label>
            <Input
              type="date"
              value={filterDateTo}
              onChange={(e) => {
                const val = e.target.value;
                setFilterDateTo(val);
                if (filterDateFrom && val < filterDateFrom) setFilterDateFrom(val);
              }}
              className="h-8 text-sm w-32 sm:w-36"
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
              Clear
            </Button>
          )}
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "entries" | "summary")}>
          <TabsList className="h-8">
            <TabsTrigger value="entries" className="text-xs px-3 h-6">Entries</TabsTrigger>
            <TabsTrigger value="summary" className="text-xs px-3 h-6">Summary</TabsTrigger>
          </TabsList>

          {/* ── Entries tab ── */}
          <TabsContent value="entries" className="mt-2">
            <div className="flex items-center justify-between mb-2 gap-2">
              <span className="text-xs text-muted-foreground">
                {filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"} —{" "}
                <strong className="text-foreground">{formatDuration(totalMinutes)}</strong> total
                {selectedEntryIds.size > 0 && (
                  <> · <strong className="text-foreground">{selectedEntryIds.size}</strong> selected</>
                )}
              </span>
              <div className="flex gap-1">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => setMoveOpen(true)}
                  disabled={selectedEntryIds.size === 0}
                >
                  <ArrowRightLeft className="w-3.5 h-3.5 mr-1" /> Move…
                </Button>
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
            <ScrollArea className="h-[380px] rounded-md border">
              <div className="overflow-x-auto">
                <Table className="min-w-[480px]">
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-8">
                        <Checkbox
                          checked={filteredEntries.length > 0 && filteredEntries.every((e) => selectedEntryIds.has(e.id))}
                          onCheckedChange={(v) => {
                            if (v) setSelectedEntryIds(new Set(filteredEntries.map((e) => e.id)));
                            else setSelectedEntryIds(new Set());
                          }}
                          aria-label="Select all"
                        />
                      </TableHead>
                      <TableHead className="w-20 text-right">Duration</TableHead>
                      <TableHead className="w-24">Date</TableHead>
                      <TableHead className="w-32 hidden sm:table-cell">User</TableHead>
                      <TableHead>Work Item / Backlog</TableHead>
                      <TableHead className="hidden md:table-cell">Note</TableHead>
                      <TableHead className="w-10" />
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {filteredEntries.length === 0 ? (
                      <TableRow>
                        <TableCell colSpan={7} className="text-center text-muted-foreground py-8">
                          No time entries found.
                        </TableCell>
                      </TableRow>
                    ) : (
                      filteredEntries.map((entry) =>
                        editingEntryId === entry.id ? (
                          /* ── Inline edit row ── */
                          <TableRow key={entry.id} className="bg-muted/20">
                            <TableCell colSpan={7} className="py-2 px-3">
                              <div className="flex flex-wrap items-end gap-2">
                                <div className="space-y-1">
                                  <Label className="text-xs">Duration</Label>
                                  <Input
                                    ref={editDurationRef}
                                    value={editDurationInput}
                                    onChange={(e) => setEditDurationInput(e.target.value)}
                                    placeholder='e.g. "1.5", "1h 30m"'
                                    className="h-8 text-sm w-28 sm:w-32"
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
                                    className="h-8 text-sm w-32 sm:w-36"
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
                            className={cn("group", canModify(entry) && "hover:bg-muted/40")}
                            title={canModify(entry) ? "Click duration/date/note to edit" : undefined}
                          >
                            <TableCell className="py-1" onClick={(e) => e.stopPropagation()}>
                              <Checkbox
                                checked={selectedEntryIds.has(entry.id)}
                                onCheckedChange={() => {
                                  setSelectedEntryIds((prev) => {
                                    const next = new Set(prev);
                                    if (next.has(entry.id)) next.delete(entry.id);
                                    else next.add(entry.id);
                                    return next;
                                  });
                                }}
                                aria-label="Select entry"
                              />
                            </TableCell>
                            <TableCell
                              className={cn("text-xs tabular-nums text-right", canModify(entry) && "cursor-pointer")}
                              onClick={() => canModify(entry) && startEditing(entry)}
                            >
                              {formatDuration(entry.durationMinutes)}
                            </TableCell>
                            <TableCell className="text-xs tabular-nums">{entry.spentDate}</TableCell>
                            <TableCell className="text-xs truncate max-w-[128px] hidden sm:table-cell" title={userNames[entry.userId]}>
                              {userNames[entry.userId] ?? entry.userId.slice(0, 8)}
                            </TableCell>
                            <TableCell className="text-xs truncate max-w-[160px]" title={getSubject(entry)}>
                              {getSubject(entry)}
                            </TableCell>
                            <TableCell className="text-xs text-muted-foreground truncate max-w-[160px] hidden md:table-cell" title={entry.note ?? ""}>
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
              </div>
            </ScrollArea>
          </TabsContent>

          {/* ── Summary tab ── */}
          <TabsContent value="summary" className="mt-2">
            {/* Group-by dimension toggles */}
            <div className="flex flex-wrap items-center gap-2 mb-3">
              <span className="text-xs text-muted-foreground font-medium">Group by:</span>
              {ALL_DIMS.map((dim) => {
                const active = groupDims.includes(dim);
                const order = active ? groupDims.indexOf(dim) + 1 : null;
                return (
                  <button
                    key={dim}
                    onClick={() => toggleGroupDim(dim)}
                    className={cn(
                      "inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium border transition-colors",
                      active
                        ? "bg-primary text-primary-foreground border-primary"
                        : "bg-background text-muted-foreground border-input hover:border-foreground hover:text-foreground",
                    )}
                  >
                    {order !== null && (
                      <span className="text-[10px] opacity-70">{order}</span>
                    )}
                    {DIMENSION_LABELS[dim]}
                  </button>
                );
              })}
              <span className="ml-auto text-xs text-muted-foreground">
                <strong className="text-foreground">{formatDuration(totalMinutes)}</strong> total
                {" · "}{filteredEntries.length} {filteredEntries.length === 1 ? "entry" : "entries"}
              </span>
            </div>

            <ScrollArea className="h-[380px] rounded-md border">
              <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>
                      {groupDims.length > 0
                        ? groupDims.map((d) => DIMENSION_LABELS[d]).join(" › ")
                        : "Group"}
                    </TableHead>
                    <TableHead className="text-right w-24">Total</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {filteredEntries.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={2} className="text-center text-muted-foreground py-8">
                        No time entries found.
                      </TableCell>
                    </TableRow>
                  ) : groupDims.length === 0 ? (
                    <TableRow>
                      <TableCell className="text-xs text-muted-foreground">All entries</TableCell>
                      <TableCell className="text-xs tabular-nums text-right pr-4 font-medium">
                        {formatDuration(totalMinutes)}
                      </TableCell>
                    </TableRow>
                  ) : (
                    <SummaryGroupRows
                      entries={filteredEntries}
                      dims={groupDims}
                      depth={0}
                      path=""
                      expandedPaths={expandedPaths}
                      onToggleExpand={toggleExpand}
                      workItems={workItems}
                      backlogs={backlogs}
                      backlogTrees={backlogTrees}
                      userNames={userNames}
                    />
                  )}
                </TableBody>
              </Table>
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
      </DialogContent>
    </Dialog>
  );
}