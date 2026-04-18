import { useEffect, useMemo, useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ArrowDown, ArrowUp, Plus, Trash2 } from "lucide-react";
import {
  useTreeStatusesStore,
  DEFAULT_TREE_STATUSES,
  type TreeStatus,
} from "@/store/treeStatusesStore";

interface Props {
  treeId: string;
  treeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COLOR_PRESETS = [
  "#94a3b8", "#3b82f6", "#f59e0b", "#ef4444", "#22c55e",
  "#a855f7", "#ec4899", "#14b8a6", "#eab308", "#64748b",
];

function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `status_${Math.random().toString(36).slice(2, 7)}`;
}

export function TreeStatusesDialog({ treeId, treeName, open, onOpenChange }: Props) {
  const statuses = useTreeStatusesStore((s) => s.statusesByTree[treeId]);
  const loadStatusesForTrees = useTreeStatusesStore((s) => s.loadStatusesForTrees);
  const createStatus = useTreeStatusesStore((s) => s.createStatus);
  const updateStatus = useTreeStatusesStore((s) => s.updateStatus);
  const deleteStatus = useTreeStatusesStore((s) => s.deleteStatus);
  const reorderStatuses = useTreeStatusesStore((s) => s.reorderStatuses);

  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);

  useEffect(() => {
    if (open) loadStatusesForTrees([treeId]);
  }, [open, treeId, loadStatusesForTrees]);

  const list: TreeStatus[] = useMemo(
    () =>
      statuses && statuses.length > 0
        ? statuses
        : // Show defaults as a hint while loading; not editable until persisted.
          [],
    [statuses],
  );

  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const usedKeys = new Set(list.map((s) => s.key));
    let key = slugifyKey(label);
    let i = 2;
    while (usedKeys.has(key)) key = `${slugifyKey(label)}_${i++}`;
    await createStatus(treeId, key, label, newColor);
    setNewLabel("");
  };

  const moveUp = (index: number) => {
    if (index === 0) return;
    const ids = list.map((s) => s.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    reorderStatuses(treeId, ids);
  };

  const moveDown = (index: number) => {
    if (index === list.length - 1) return;
    const ids = list.map((s) => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorderStatuses(treeId, ids);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Statuses — {treeName}</DialogTitle>
          <DialogDescription>
            Configure the statuses available for work items in this backlog tree. Anyone
            with access to the tree can edit these.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {list.length === 0 && (
            <p className="text-sm text-muted-foreground italic">
              No statuses yet. Defaults will appear here once loaded; add your own below.
            </p>
          )}
          {list.map((s, idx) => (
            <StatusRow
              key={s.id}
              status={s}
              isFirst={idx === 0}
              isLast={idx === list.length - 1}
              onLabel={(label) => updateStatus(s.id, { label })}
              onColor={(color) => updateStatus(s.id, { color })}
              onUp={() => moveUp(idx)}
              onDown={() => moveDown(idx)}
              onDelete={() => deleteStatus(s.id)}
              canDelete={list.length > 1}
            />
          ))}
        </div>

        <div className="border-t pt-3 space-y-2">
          <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
            Add status
          </p>
          <div className="flex items-center gap-2">
            <input
              type="color"
              value={newColor}
              onChange={(e) => setNewColor(e.target.value)}
              className="w-9 h-9 rounded border border-input bg-background cursor-pointer shrink-0"
            />
            <Input
              placeholder="Status name"
              value={newLabel}
              onChange={(e) => setNewLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  handleAdd();
                }
              }}
            />
            <Button onClick={handleAdd} size="sm">
              <Plus className="w-4 h-4 mr-1" /> Add
            </Button>
          </div>
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>
            Done
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function StatusRow({
  status,
  isFirst,
  isLast,
  onLabel,
  onColor,
  onUp,
  onDown,
  onDelete,
  canDelete,
}: {
  status: TreeStatus;
  isFirst: boolean;
  isLast: boolean;
  onLabel: (v: string) => void;
  onColor: (v: string) => void;
  onUp: () => void;
  onDown: () => void;
  onDelete: () => void;
  canDelete: boolean;
}) {
  const [label, setLabel] = useState(status.label);
  useEffect(() => setLabel(status.label), [status.label]);

  const commit = () => {
    const trimmed = label.trim();
    if (trimmed && trimmed !== status.label) onLabel(trimmed);
    else if (!trimmed) setLabel(status.label);
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="color"
        value={status.color}
        onChange={(e) => onColor(e.target.value)}
        className="w-8 h-8 rounded border border-input bg-background cursor-pointer shrink-0"
        title="Color"
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="flex-1"
      />
      <Button variant="ghost" size="icon" onClick={onUp} disabled={isFirst} title="Move up">
        <ArrowUp className="w-4 h-4" />
      </Button>
      <Button variant="ghost" size="icon" onClick={onDown} disabled={isLast} title="Move down">
        <ArrowDown className="w-4 h-4" />
      </Button>
      <Button
        variant="ghost"
        size="icon"
        onClick={onDelete}
        disabled={!canDelete}
        className="text-destructive hover:text-destructive hover:bg-destructive/10"
        title={canDelete ? "Delete" : "Tree must keep at least one status"}
      >
        <Trash2 className="w-4 h-4" />
      </Button>
    </div>
  );
}
