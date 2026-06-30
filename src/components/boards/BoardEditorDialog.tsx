import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { Trash2, Plus, GripVertical } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import { useBoardsStore, type Board, type BoardScope, type BoardColumn } from "@/store/boardsStore";
import { useAppStore } from "@/store/appStore";
import { WORK_ITEM_STATUSES, type WorkItemStatus } from "@/types/models";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  organizationId: string;
  /** If provided, edit existing board; otherwise create a new one. */
  boardId?: string | null;
  onCreated?: (boardId: string) => void;
}

const DEFAULT_COLUMNS: { name: string; statuses: WorkItemStatus[]; color: string }[] = [
  { name: "To do", statuses: ["not_started"], color: "#94a3b8" },
  { name: "In progress", statuses: ["in_progress"], color: "#f97316" },
  { name: "Blocked", statuses: ["blocked"], color: "#ef4444" },
  { name: "Done", statuses: ["done"], color: "#22c55e" },
];

export function BoardEditorDialog({ open, onOpenChange, organizationId, boardId, onCreated }: Props) {
  const board: Board | undefined = useBoardsStore((s) => (boardId ? s.boards[boardId] : undefined));
  const columnsRaw = useBoardsStore((s) => s.columns);
  const columns = useMemo(
    () =>
      Object.values(columnsRaw)
        .filter((c) => boardId && c.boardId === boardId)
        .sort((a, b) => a.rank - b.rank),
    [columnsRaw, boardId],
  );
  const createBoard = useBoardsStore((s) => s.createBoard);
  const updateBoard = useBoardsStore((s) => s.updateBoard);
  const createColumn = useBoardsStore((s) => s.createColumn);
  const updateColumn = useBoardsStore((s) => s.updateColumn);
  const deleteColumn = useBoardsStore((s) => s.deleteColumn);
  const reorderColumns = useBoardsStore((s) => s.reorderColumns);

  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const trees = Object.values(backlogTrees).filter((t) => t.id.startsWith(`${organizationId}::`));

  const [name, setName] = useState("");
  const [scope, setScope] = useState<BoardScope>("tree");
  const [treeId, setTreeId] = useState<string>("");

  useEffect(() => {
    if (!open) return;
    if (board) {
      setName(board.name);
      setScope(board.scope);
      setTreeId(board.treeId ?? "");
    } else {
      setName("");
      setScope("tree");
      setTreeId(trees[0]?.id ?? "");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, boardId]);

  async function handleCreate() {
    if (!name.trim()) { toast({ title: "Name required" }); return; }
    if (scope === "tree" && !treeId) { toast({ title: "Pick a tree" }); return; }
    const b = await createBoard({
      organizationId,
      name: name.trim(),
      scope,
      treeId: scope === "tree" ? treeId : null,
    });
    if (!b) { toast({ title: "Failed to create board", variant: "destructive" }); return; }
    for (let i = 0; i < DEFAULT_COLUMNS.length; i++) {
      const d = DEFAULT_COLUMNS[i];
      await createColumn({
        boardId: b.id,
        organizationId,
        name: d.name,
        color: d.color,
        rule: { statuses: d.statuses },
      });
    }
    onCreated?.(b.id);
    onOpenChange(false);
  }

  async function handleSaveBoardMeta() {
    if (!board) return;
    await updateBoard(board.id, {
      name: name.trim() || board.name,
      scope,
      treeId: scope === "tree" ? treeId : null,
    });
    toast({ title: "Saved" });
  }

  async function addColumn() {
    if (!board) return;
    await createColumn({ boardId: board.id, organizationId, name: "New column", color: "#94a3b8", rule: {} });
  }

  async function moveColumn(idx: number, delta: number) {
    if (!board) return;
    const next = [...columns];
    const target = idx + delta;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    await reorderColumns(board.id, next.map((c) => c.id));
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle>{board ? "Edit board" : "New board"}</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <div>
            <Label className="text-xs">Name</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint board" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <Label className="text-xs">Scope</Label>
              <Select value={scope} onValueChange={(v) => setScope(v as BoardScope)}>
                <SelectTrigger><SelectValue /></SelectTrigger>
                <SelectContent>
                  <SelectItem value="tree">Single backlog tree</SelectItem>
                  <SelectItem value="custom">Custom (cross-tree)</SelectItem>
                </SelectContent>
              </Select>
            </div>
            {scope === "tree" && (
              <div>
                <Label className="text-xs">Tree</Label>
                <Select value={treeId} onValueChange={setTreeId}>
                  <SelectTrigger><SelectValue placeholder="Pick a tree" /></SelectTrigger>
                  <SelectContent>
                    {trees.map((t) => <SelectItem key={t.id} value={t.id}>{t.name}</SelectItem>)}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>

          {board && (
            <div className="border-t pt-3">
              <div className="flex items-center justify-between mb-2">
                <Label className="text-xs">Columns</Label>
                <Button variant="outline" size="sm" onClick={addColumn}>
                  <Plus className="w-3.5 h-3.5 mr-1" /> Add column
                </Button>
              </div>
              <div className="space-y-2 max-h-[40vh] overflow-y-auto">
                {columns.map((col, idx) => (
                  <ColumnRow
                    key={col.id}
                    column={col}
                    onChange={(patch) => updateColumn(col.id, patch)}
                    onDelete={() => deleteColumn(col.id)}
                    onMoveUp={() => moveColumn(idx, -1)}
                    onMoveDown={() => moveColumn(idx, 1)}
                  />
                ))}
                {columns.length === 0 && (
                  <p className="text-xs text-muted-foreground py-2">No columns yet. Add one.</p>
                )}
              </div>
            </div>
          )}
        </div>

        <DialogFooter>
          {!board ? (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
              <Button onClick={handleCreate}>Create</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={handleSaveBoardMeta}>Save</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ColumnRow({
  column,
  onChange,
  onDelete,
  onMoveUp,
  onMoveDown,
}: {
  column: BoardColumn;
  onChange: (patch: Partial<BoardColumn>) => void;
  onDelete: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  const selectedStatuses = column.rule.statuses ?? [];
  function toggleStatus(s: WorkItemStatus) {
    const set = new Set(selectedStatuses);
    if (set.has(s)) set.delete(s); else set.add(s);
    onChange({ rule: { ...column.rule, statuses: Array.from(set) } });
  }
  return (
    <div className="border rounded-md p-2 space-y-2 bg-card">
      <div className="flex items-center gap-2">
        <button className="text-muted-foreground" onClick={onMoveUp} title="Move up"><GripVertical className="w-4 h-4" /></button>
        <Input value={column.name} onChange={(e) => onChange({ name: e.target.value })} className="h-8 flex-1" />
        <Input
          type="color"
          value={column.color}
          onChange={(e) => onChange({ color: e.target.value })}
          className="h-8 w-12 p-0.5"
        />
        <Button variant="ghost" size="sm" onClick={onDelete}><Trash2 className="w-4 h-4" /></Button>
      </div>
      <div className="flex items-center justify-between gap-2">
        <div className="flex flex-wrap gap-1">
          {WORK_ITEM_STATUSES.map((s) => {
            const active = selectedStatuses.includes(s.value);
            return (
              <button
                key={s.value}
                onClick={() => toggleStatus(s.value)}
                className={`text-xs px-2 py-0.5 rounded-full border transition-colors ${active ? "bg-primary/15 border-primary text-primary" : "bg-muted/40 border-border text-muted-foreground hover:bg-muted"}`}
              >{s.label}</button>
            );
          })}
        </div>
        <div className="flex items-center gap-2">
          <Label className="text-xs">Unmatched</Label>
          <Switch checked={column.isUnmatched} onCheckedChange={(v) => onChange({ isUnmatched: v })} />
        </div>
      </div>
      <div className="flex justify-end">
        <button className="text-xs text-muted-foreground hover:text-foreground" onClick={onMoveDown}>Move down</button>
      </div>
    </div>
  );
}
