import { useState, useMemo, useEffect } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { useAppStore } from "@/store/appStore";
import { useTimeEntryStore, TimeEntry } from "@/store/timeEntryStore";
import { formatDuration } from "@/components/TimeLogDialog";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

export type MoveSourceContext =
  | { kind: "work_item"; id: string }
  | { kind: "backlog"; id: string }
  | { kind: "tree"; id: string }
  | { kind: "selection"; entryIds: string[] };

interface MoveTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  source: MoveSourceContext;
}

type TargetKind = "tree" | "backlog" | "work_item";

export function MoveTimeDialog({ open, onOpenChange, source }: MoveTimeDialogProps) {
  const timeEntries = useTimeEntryStore((s) => s.timeEntries);
  const moveTimeEntries = useTimeEntryStore((s) => s.moveTimeEntries);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);

  // Candidate entries based on source
  const candidateEntries = useMemo<TimeEntry[]>(() => {
    const list = Object.values(timeEntries);
    switch (source.kind) {
      case "work_item":
        return list.filter((e) => e.workItemId === source.id);
      case "backlog":
        return list.filter((e) => e.backlogId === source.id && e.workItemId === null);
      case "tree":
        return list.filter((e) => e.treeId === source.id && e.workItemId === null && e.backlogId === null);
      case "selection":
        return source.entryIds.map((id) => timeEntries[id]).filter(Boolean);
    }
  }, [timeEntries, source]);

  const isSelectionSource = source.kind === "selection";

  // Mode: all vs selected (only meaningful when opened from TimeLogDialog)
  const [mode, setMode] = useState<"all" | "selected">("all");
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());

  const [tab, setTab] = useState<TargetKind>("backlog");
  const [search, setSearch] = useState("");
  const [targetId, setTargetId] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setMode("all");
      setSelectedIds(new Set());
      setSearch("");
      setTargetId(null);
      setTab("backlog");
    }
  }, [open, source]);

  const entriesToMove = useMemo(() => {
    if (isSelectionSource) return candidateEntries;
    if (mode === "all") return candidateEntries;
    return candidateEntries.filter((e) => selectedIds.has(e.id));
  }, [candidateEntries, mode, selectedIds, isSelectionSource]);

  const totalMinutes = entriesToMove.reduce((s, e) => s + e.durationMinutes, 0);

  // Build sorted lists for each tab
  const treeList = useMemo(() => {
    const q = search.trim().toLowerCase();
    return Object.values(backlogTrees)
      .filter((t) => !q || t.name.toLowerCase().includes(q))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [backlogTrees, search]);

  const backlogList = useMemo(() => {
    const q = search.trim().toLowerCase();
    const items = Object.values(backlogs).map((b) => ({
      backlog: b,
      treeName: backlogTrees[b.treeId]?.name ?? "",
    }));
    return items
      .filter(({ backlog, treeName }) =>
        !q || backlog.name.toLowerCase().includes(q) || treeName.toLowerCase().includes(q),
      )
      .sort((a, b) =>
        a.treeName.localeCompare(b.treeName) || a.backlog.name.localeCompare(b.backlog.name),
      );
  }, [backlogs, backlogTrees, search]);

  const workItemList = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return [] as { item: typeof workItems[string]; context: string }[];
    return Object.values(workItems)
      .filter((wi) => wi.title.toLowerCase().includes(q))
      .slice(0, 100)
      .map((wi) => {
        const treeIds = Object.keys(wi.backlogAssignments ?? {});
        const context =
          treeIds
            .map((tid) => {
              const blId = wi.backlogAssignments[tid];
              const blName = backlogs[blId]?.name ?? "";
              const trName = backlogTrees[tid]?.name ?? "";
              return blName ? `${trName} / ${blName}` : trName;
            })
            .filter(Boolean)
            .join(", ") || "(no backlog)";
        return { item: wi, context };
      })
      .sort((a, b) => a.item.title.localeCompare(b.item.title));
  }, [workItems, backlogs, backlogTrees, search]);

  const toggleSelected = (id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const handleMove = async () => {
    if (entriesToMove.length === 0) {
      toast({ title: "No entries selected", variant: "destructive" });
      return;
    }
    if (!targetId) {
      toast({ title: "Pick a destination", variant: "destructive" });
      return;
    }
    setSubmitting(true);
    try {
      const count = await moveTimeEntries(
        entriesToMove.map((e) => e.id),
        { kind: tab, id: targetId },
      );
      toast({
        title: "Time moved",
        description: `${count} ${count === 1 ? "entry" : "entries"} · ${formatDuration(totalMinutes)}`,
      });
      onOpenChange(false);
    } catch (err: unknown) {
      toast({
        title: "Move failed",
        description: err instanceof Error ? err.message : String(err),
        variant: "destructive",
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Move time</DialogTitle>
        </DialogHeader>

        <div className="text-xs text-muted-foreground">
          Moving <strong className="text-foreground">{entriesToMove.length}</strong>{" "}
          {entriesToMove.length === 1 ? "entry" : "entries"} ·{" "}
          <strong className="text-foreground">{formatDuration(totalMinutes)}</strong>
        </div>

        {!isSelectionSource && candidateEntries.length > 0 && (
          <div className="space-y-2">
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as "all" | "selected")}>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="all" id="mode-all" />
                <Label htmlFor="mode-all" className="text-sm font-normal cursor-pointer">
                  All entries on this target ({candidateEntries.length})
                </Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="selected" id="mode-selected" />
                <Label htmlFor="mode-selected" className="text-sm font-normal cursor-pointer">
                  Selected entries only
                </Label>
              </div>
            </RadioGroup>

            {mode === "selected" && (
              <ScrollArea className="h-32 rounded-md border p-1">
                <div className="space-y-0.5">
                  {candidateEntries.map((e) => (
                    <label
                      key={e.id}
                      className="flex items-center gap-2 px-2 py-1 rounded hover:bg-muted/40 cursor-pointer"
                    >
                      <Checkbox
                        checked={selectedIds.has(e.id)}
                        onCheckedChange={() => toggleSelected(e.id)}
                      />
                      <span className="text-xs tabular-nums w-14">{formatDuration(e.durationMinutes)}</span>
                      <span className="text-xs tabular-nums text-muted-foreground w-24">{e.spentDate}</span>
                      <span className="text-xs text-muted-foreground truncate flex-1">{e.note ?? ""}</span>
                    </label>
                  ))}
                </div>
              </ScrollArea>
            )}
          </div>
        )}

        <div className="space-y-2">
          <Label className="text-xs">Destination</Label>
          <Tabs value={tab} onValueChange={(v) => { setTab(v as TargetKind); setTargetId(null); }}>
            <TabsList className="h-8">
              <TabsTrigger value="tree" className="text-xs px-3 h-6">Trees</TabsTrigger>
              <TabsTrigger value="backlog" className="text-xs px-3 h-6">Backlogs</TabsTrigger>
              <TabsTrigger value="work_item" className="text-xs px-3 h-6">Work items</TabsTrigger>
            </TabsList>
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder={tab === "work_item" ? "Type to search work items…" : "Search…"}
              className="h-8 text-sm mt-2"
            />

            <TabsContent value="tree" className="mt-2">
              <ScrollArea className="h-52 rounded-md border">
                <div className="p-1">
                  {treeList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No trees.</p>
                  ) : (
                    treeList.map((t) => (
                      <button
                        key={t.id}
                        onClick={() => setTargetId(t.id)}
                        className={cn(
                          "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted/40",
                          targetId === t.id && "bg-primary/10 ring-1 ring-primary",
                        )}
                      >
                        {t.name}
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="backlog" className="mt-2">
              <ScrollArea className="h-52 rounded-md border">
                <div className="p-1">
                  {backlogList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No backlogs.</p>
                  ) : (
                    backlogList.map(({ backlog, treeName }) => (
                      <button
                        key={backlog.id}
                        onClick={() => setTargetId(backlog.id)}
                        className={cn(
                          "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted/40",
                          targetId === backlog.id && "bg-primary/10 ring-1 ring-primary",
                        )}
                      >
                        <div>{backlog.name}</div>
                        <div className="text-[10px] text-muted-foreground">{treeName}</div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>

            <TabsContent value="work_item" className="mt-2">
              <ScrollArea className="h-52 rounded-md border">
                <div className="p-1">
                  {search.trim() === "" ? (
                    <p className="text-xs text-muted-foreground text-center py-4">
                      Start typing to search work items.
                    </p>
                  ) : workItemList.length === 0 ? (
                    <p className="text-xs text-muted-foreground text-center py-4">No matches.</p>
                  ) : (
                    workItemList.map(({ item, context }) => (
                      <button
                        key={item.id}
                        onClick={() => setTargetId(item.id)}
                        className={cn(
                          "w-full text-left px-2 py-1.5 rounded text-sm hover:bg-muted/40",
                          targetId === item.id && "bg-primary/10 ring-1 ring-primary",
                        )}
                      >
                        <div className="truncate">{item.title}</div>
                        <div className="text-[10px] text-muted-foreground truncate">{context}</div>
                      </button>
                    ))
                  )}
                </div>
              </ScrollArea>
            </TabsContent>
          </Tabs>
        </div>

        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)}>
            Cancel
          </Button>
          <Button
            onClick={handleMove}
            disabled={submitting || !targetId || entriesToMove.length === 0}
          >
            Move {entriesToMove.length} {entriesToMove.length === 1 ? "entry" : "entries"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
