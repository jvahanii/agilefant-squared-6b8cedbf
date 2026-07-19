import { useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useAppStore } from "@/store/appStore";
import { useTimeEntryStore } from "@/store/timeEntryStore";
import { toast } from "@/hooks/use-toast";

export type MoveTimeTarget =
  | { kind: "work_item"; id: string }
  | { kind: "backlog"; id: string }
  | { kind: "tree"; id: string };

interface MoveTimeDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  entryIds: string[];
  title?: string;
  onMoved?: () => void;
  excludeTarget?: MoveTimeTarget;
}

export function MoveTimeDialog({
  open,
  onOpenChange,
  entryIds,
  title,
  onMoved,
  excludeTarget,
}: MoveTimeDialogProps) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const moveTimeEntries = useTimeEntryStore((s) => s.moveTimeEntries);

  const [tab, setTab] = useState<"work_item" | "backlog" | "tree">("work_item");
  const [query, setQuery] = useState("");
  const [selected, setSelected] = useState<MoveTimeTarget | null>(null);
  const [busy, setBusy] = useState(false);

  const items = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list =
      tab === "work_item"
        ? Object.values(workItems).map((w) => ({ id: w.id, label: w.title }))
        : tab === "backlog"
          ? Object.values(backlogs).map((b) => ({
              id: b.id,
              label: `${b.name}  ·  ${backlogTrees[b.treeId]?.name ?? ""}`,
            }))
          : Object.values(backlogTrees).map((t) => ({ id: t.id, label: t.name }));
    return list
      .filter((it) => {
        if (excludeTarget && excludeTarget.kind === tab && excludeTarget.id === it.id) return false;
        return !q || it.label.toLowerCase().includes(q);
      })
      .sort((a, b) => a.label.localeCompare(b.label))
      .slice(0, 200);
  }, [tab, query, workItems, backlogs, backlogTrees, excludeTarget]);

  const handleMove = async () => {
    if (!selected || entryIds.length === 0) return;
    setBusy(true);
    try {
      const n = await moveTimeEntries(entryIds, selected);
      toast({ title: `Moved ${n} time ${n === 1 ? "entry" : "entries"}` });
      onOpenChange(false);
      onMoved?.();
    } catch (e) {
      toast({
        title: "Failed to move time entries",
        description: (e as Error).message,
        variant: "destructive",
      });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>{title ?? `Move ${entryIds.length} time ${entryIds.length === 1 ? "entry" : "entries"}`}</DialogTitle>
        </DialogHeader>
        <Tabs value={tab} onValueChange={(v) => { setTab(v as typeof tab); setSelected(null); }}>
          <TabsList className="grid grid-cols-3 w-full">
            <TabsTrigger value="work_item">Work items</TabsTrigger>
            <TabsTrigger value="backlog">Backlogs</TabsTrigger>
            <TabsTrigger value="tree">Trees</TabsTrigger>
          </TabsList>
          <div className="mt-3">
            <Input
              autoFocus
              placeholder="Search…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <TabsContent value={tab} className="mt-2">
            <ScrollArea className="h-64 border rounded-md">
              <div className="p-1">
                {items.length === 0 && (
                  <div className="text-sm text-muted-foreground p-3">No matches</div>
                )}
                {items.map((it) => {
                  const isSel = selected?.kind === tab && selected.id === it.id;
                  return (
                    <button
                      key={it.id}
                      type="button"
                      onClick={() => setSelected({ kind: tab, id: it.id })}
                      className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
                        isSel ? "bg-accent text-accent-foreground" : "hover:bg-muted"
                      }`}
                    >
                      {it.label || <span className="italic text-muted-foreground">(untitled)</span>}
                    </button>
                  );
                })}
              </div>
            </ScrollArea>
          </TabsContent>
        </Tabs>
        <DialogFooter>
          <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy}>
            Cancel
          </Button>
          <Button onClick={handleMove} disabled={!selected || busy}>
            {busy ? "Moving…" : "Move"}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
