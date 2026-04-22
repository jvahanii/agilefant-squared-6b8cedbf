import { useEffect, useMemo, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Label } from "@/components/ui/label";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Checkbox } from "@/components/ui/checkbox";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Archive, DownloadCloud, Loader2, RotateCcw, Trash2 } from "lucide-react";
import { toast } from "@/hooks/use-toast";

interface BackupRow {
  id: string;
  created_at: string;
  kind: "auto" | "manual";
  size_bytes: number;
  note: string | null;
}

type ScopeType = "all" | "trees" | "backlogs";
type Mode = "merge" | "overwrite" | "copy";

const MODE_DESCRIPTIONS: Record<Mode, string> = {
  merge: "Upsert by id. Items missing from the snapshot survive.",
  overwrite: "Delete current items in scope, then re-insert from the snapshot. Destructive — current changes within scope are lost.",
  copy: "Create duplicates with new ids (names suffixed). Never touches existing items.",
};

export function BackupsCard() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const [backups, setBackups] = useState<BackupRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState(false);
  const [restoreOpen, setRestoreOpen] = useState<BackupRow | null>(null);

  const loadBackups = async () => {
    if (!activeOrgId) return;
    setLoading(true);
    const { data, error } = await (supabase as any)
      .from("organization_backups")
      .select("id, created_at, kind, size_bytes, note")
      .eq("organization_id", activeOrgId)
      .order("created_at", { ascending: false });
    setLoading(false);
    if (error) {
      toast({ title: "Failed to load backups", description: error.message, variant: "destructive" });
      return;
    }
    setBackups((data as BackupRow[]) ?? []);
  };

  useEffect(() => {
    loadBackups();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  const handleCreate = async () => {
    if (!activeOrgId) return;
    setCreating(true);
    const { error } = await (supabase as any).rpc("create_organization_backup", {
      _org_id: activeOrgId,
      _kind: "manual",
      _note: null,
    });
    setCreating(false);
    if (error) {
      toast({ title: "Backup failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Backup created" });
    loadBackups();
  };

  const handleDelete = async (id: string) => {
    const { error } = await (supabase as any).from("organization_backups").delete().eq("id", id);
    if (error) {
      toast({ title: "Delete failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({ title: "Backup deleted" });
    loadBackups();
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base flex items-center gap-2">
          <Archive className="w-4 h-4" /> Backups & Restore
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-foreground">
            Automatic daily snapshots kept for 30 days. You can also create manual backups.
          </p>
          <Button size="sm" onClick={handleCreate} disabled={creating || !activeOrgId}>
            {creating ? <Loader2 className="w-4 h-4 animate-spin" /> : <DownloadCloud className="w-4 h-4" />}
            <span className="ml-1">Backup now</span>
          </Button>
        </div>

        <div className="border rounded-md divide-y">
          {loading && <p className="p-3 text-sm text-muted-foreground">Loading…</p>}
          {!loading && backups.length === 0 && (
            <p className="p-3 text-sm text-muted-foreground">No backups yet.</p>
          )}
          {backups.map((b) => (
            <div key={b.id} className="flex items-center justify-between p-2 gap-2">
              <div className="min-w-0">
                <div className="text-sm font-medium truncate">
                  {new Date(b.created_at).toLocaleString()}
                </div>
                <div className="text-xs text-muted-foreground flex gap-2 items-center">
                  <Badge variant="secondary" className="h-4 px-1 text-[10px]">
                    {b.kind}
                  </Badge>
                  <span>{(b.size_bytes / 1024).toFixed(1)} KB</span>
                </div>
              </div>
              <div className="flex gap-1">
                <Button size="sm" variant="outline" onClick={() => setRestoreOpen(b)}>
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span className="ml-1 hidden sm:inline">Restore</span>
                </Button>
                <Button size="sm" variant="ghost" onClick={() => handleDelete(b.id)}>
                  <Trash2 className="w-3.5 h-3.5 text-destructive" />
                </Button>
              </div>
            </div>
          ))}
        </div>

        {restoreOpen && (
          <RestoreDialog
            backup={restoreOpen}
            onClose={(didRestore) => {
              setRestoreOpen(null);
              if (didRestore) loadBackups();
            }}
          />
        )}
      </CardContent>
    </Card>
  );
}

const SCOPE_BADGE_CLS = "h-4 px-1.5 text-[10px]";

function SelectionControls({
  total,
  label,
  onSelectAll,
  onClear,
}: {
  total: number;
  label: string;
  onSelectAll: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex items-center justify-between">
      <Label className="text-xs text-muted-foreground">
        {total === 0 ? `No ${label} found` : `${total} ${label}${total !== 1 ? "s" : ""} available`}
      </Label>
      {total > 0 && (
        <div className="flex gap-2 text-xs">
          <button type="button" className="text-primary hover:underline" onClick={onSelectAll}>
            Select all
          </button>
          <span className="text-muted-foreground">·</span>
          <button type="button" className="text-muted-foreground hover:underline" onClick={onClear}>
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

function RestoreDialog({ backup, onClose }: { backup: BackupRow; onClose: (didRestore: boolean) => void }) {
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const backlogs = useAppStore((s) => s.backlogs);
  const [scope, setScope] = useState<ScopeType>("all");
  const [mode, setMode] = useState<Mode>("merge");
  const [selectedTrees, setSelectedTrees] = useState<Set<string>>(new Set());
  const [selectedBacklogs, setSelectedBacklogs] = useState<Set<string>>(new Set());
  const [running, setRunning] = useState(false);

  const trees = useMemo(() => Object.values(backlogTrees).sort((a, b) => a.rank - b.rank), [backlogTrees]);
  const backlogList = useMemo(() => Object.values(backlogs).sort((a, b) => a.rank - b.rank), [backlogs]);

  // Backlogs grouped by their parent tree, preserving tree rank order
  const backlogsByTree = useMemo(() => {
    const grouped: { tree: (typeof trees)[number]; backlogs: typeof backlogList }[] = [];
    for (const tree of trees) {
      const treeBacklogs = backlogList.filter((b) => b.treeId === tree.id);
      if (treeBacklogs.length > 0) grouped.push({ tree, backlogs: treeBacklogs });
    }
    // Backlogs with no matching tree (shouldn't happen, but be safe)
    const orphans = backlogList.filter((b) => !backlogTrees[b.treeId]);
    if (orphans.length > 0) {
      const orphanTree: (typeof trees)[number] = { id: "", name: "Other", rootBacklogIds: [], rank: Infinity };
      grouped.push({ tree: orphanTree, backlogs: orphans });
    }
    return grouped;
  }, [trees, backlogList, backlogTrees]);

  const toggle = (set: Set<string>, setter: (s: Set<string>) => void, id: string) => {
    const next = new Set(set);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setter(next);
  };

  const handleRestore = async () => {
    let scopePayload: any = { type: "all" };
    if (scope === "trees") scopePayload = { type: "trees", ids: Array.from(selectedTrees) };
    if (scope === "backlogs") scopePayload = { type: "backlogs", ids: Array.from(selectedBacklogs) };

    if ((scope === "trees" && selectedTrees.size === 0) || (scope === "backlogs" && selectedBacklogs.size === 0)) {
      toast({ title: "Select at least one item", variant: "destructive" });
      return;
    }

    setRunning(true);
    const { data, error } = await (supabase as any).rpc("restore_organization_backup", {
      _backup_id: backup.id,
      _scope: scopePayload,
      _mode: mode,
    });
    setRunning(false);

    if (error) {
      toast({ title: "Restore failed", description: error.message, variant: "destructive" });
      return;
    }
    toast({
      title: "Restore complete",
      description: `Mode: ${mode} · ${data?.work_items ?? 0} work items, ${data?.backlogs ?? 0} backlogs, ${data?.trees ?? 0} trees`,
    });
    onClose(true);
  };

  return (
    <Dialog open onOpenChange={(open) => !open && onClose(false)}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Restore from {new Date(backup.created_at).toLocaleString()}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Scope</Label>
            <RadioGroup value={scope} onValueChange={(v) => setScope(v as ScopeType)} className="mt-1">
              <div className="flex items-center gap-2"><RadioGroupItem value="all" id="s-all" /><Label htmlFor="s-all">Everything in the snapshot</Label></div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="trees" id="s-trees" />
                <Label htmlFor="s-trees">Selected backlog trees</Label>
                {scope === "trees" && selectedTrees.size > 0 && (
                  <Badge variant="secondary" className={SCOPE_BADGE_CLS}>{selectedTrees.size}</Badge>
                )}
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="backlogs" id="s-backlogs" />
                <Label htmlFor="s-backlogs">Selected backlogs</Label>
                {scope === "backlogs" && selectedBacklogs.size > 0 && (
                  <Badge variant="secondary" className={SCOPE_BADGE_CLS}>{selectedBacklogs.size}</Badge>
                )}
              </div>
            </RadioGroup>
          </div>

          {scope === "trees" && (
            <div className="space-y-1.5">
              <SelectionControls
                total={trees.length}
                label="backlog tree"
                onSelectAll={() => setSelectedTrees(new Set(trees.map((t) => t.id)))}
                onClear={() => setSelectedTrees(new Set())}
              />
              {trees.length > 0 && (
                <ScrollArea className="h-36 border rounded-md p-2">
                  {trees.map((t) => (
                    <label key={t.id} className="flex items-center gap-2 py-1 text-sm cursor-pointer hover:bg-muted/50 rounded px-1">
                      <Checkbox checked={selectedTrees.has(t.id)} onCheckedChange={() => toggle(selectedTrees, setSelectedTrees, t.id)} />
                      {t.name}
                    </label>
                  ))}
                </ScrollArea>
              )}
            </div>
          )}

          {scope === "backlogs" && (
            <div className="space-y-1.5">
              <SelectionControls
                total={backlogList.length}
                label="backlog"
                onSelectAll={() => setSelectedBacklogs(new Set(backlogList.map((b) => b.id)))}
                onClear={() => setSelectedBacklogs(new Set())}
              />
              {backlogList.length > 0 && (
                <ScrollArea className="h-48 border rounded-md p-2">
                  {backlogsByTree.map(({ tree, backlogs: treeBacklogs }) => (
                    <div key={tree.id} className="mb-2 last:mb-0">
                      <div className="flex items-center gap-1.5 mb-0.5 px-1">
                        <span className="text-[11px] font-semibold text-muted-foreground uppercase tracking-wide truncate">
                          {tree.name}
                        </span>
                        <span className="text-[10px] text-muted-foreground">
                          ({treeBacklogs.filter((b) => selectedBacklogs.has(b.id)).length}/{treeBacklogs.length})
                        </span>
                      </div>
                      {treeBacklogs.map((b) => (
                        <label key={b.id} className="flex items-center gap-2 py-0.5 pl-3 pr-1 text-sm cursor-pointer hover:bg-muted/50 rounded">
                          <Checkbox checked={selectedBacklogs.has(b.id)} onCheckedChange={() => toggle(selectedBacklogs, setSelectedBacklogs, b.id)} />
                          {b.name}
                        </label>
                      ))}
                    </div>
                  ))}
                </ScrollArea>
              )}
            </div>
          )}

          <div>
            <Label className="text-xs font-semibold uppercase text-muted-foreground">Mode</Label>
            <RadioGroup value={mode} onValueChange={(v) => setMode(v as Mode)} className="mt-1">
              <div className="flex items-center gap-2">
                <RadioGroupItem value="merge" id="m-merge" />
                <Label htmlFor="m-merge">Merge</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="overwrite" id="m-overwrite" />
                <Label htmlFor="m-overwrite" className="text-destructive">Overwrite (destructive)</Label>
              </div>
              <div className="flex items-center gap-2">
                <RadioGroupItem value="copy" id="m-copy" />
                <Label htmlFor="m-copy">Restore as copy</Label>
              </div>
            </RadioGroup>
            <p className="text-xs text-muted-foreground mt-2">{MODE_DESCRIPTIONS[mode]}</p>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onClose(false)}>Cancel</Button>
          <Button onClick={handleRestore} disabled={running}>
            {running && <Loader2 className="w-4 h-4 animate-spin mr-1" />}
            Restore
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
