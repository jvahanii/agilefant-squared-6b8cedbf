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
import { ArrowDown, ArrowUp, Lock, Plus, Trash2 } from "lucide-react";
import {
  useBacklogStatusesStore,
  isPinnedStatus,
  getEffectiveStatuses,
  hasOwnStatuses,
  findInheritedFromBacklogId,
  type BacklogStatus,
} from "@/store/backlogStatusesStore";
import { useAppStore } from "@/store/appStore";

interface Props {
  backlogId: string;
  backlogName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const COLOR_PRESETS = [
  "#94a3b8", "#3b82f6", "#f59e0b", "#ef4444", "#22c55e",
  "#a855f7", "#ec4899", "#93c5fd", "#eab308", "#64748b",
];

function slugifyKey(label: string): string {
  return label
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 40) || `status_${Math.random().toString(36).slice(2, 7)}`;
}

export function BacklogStatusesDialog({ backlogId, backlogName, open, onOpenChange }: Props) {
  const ownStatuses = useBacklogStatusesStore((s) => s.statusesByBacklog[backlogId]);
  const backlogs = useAppStore((s) => s.backlogs);
  const createStatus = useBacklogStatusesStore((s) => s.createStatus);
  const updateStatus = useBacklogStatusesStore((s) => s.updateStatus);
  const deleteStatus = useBacklogStatusesStore((s) => s.deleteStatus);
  const reorderStatuses = useBacklogStatusesStore((s) => s.reorderStatuses);
  const materializeStatuses = useBacklogStatusesStore((s) => s.materializeStatuses);

  const [newLabel, setNewLabel] = useState("");
  const [newColor, setNewColor] = useState(COLOR_PRESETS[0]);

  const isInherited = !ownStatuses || ownStatuses.length === 0;

  const inheritedFromId = useMemo(
    () => (isInherited ? findInheritedFromBacklogId(backlogId) : null),
    [isInherited, backlogId, backlogs],
  );

  const list: BacklogStatus[] = useMemo(
    () => (ownStatuses && ownStatuses.length > 0 ? ownStatuses : getEffectiveStatuses(backlogId)),
    [ownStatuses, backlogId],
  );

  const inheritedFromName = inheritedFromId ? backlogs[inheritedFromId]?.name : null;

  const handleAdd = async () => {
    const label = newLabel.trim();
    if (!label) return;
    const usedKeys = new Set(list.map((s) => s.key));
    let key = slugifyKey(label);
    let i = 2;
    while (usedKeys.has(key)) key = `${slugifyKey(label)}_${i++}`;
    await createStatus(backlogId, key, label, newColor);
    setNewLabel("");
  };

  const moveUp = async (index: number) => {
    if (index === 0) return;
    await materializeStatuses(backlogId);
    const cur = useBacklogStatusesStore.getState().statusesByBacklog[backlogId] ?? [];
    const ids = cur.map((s) => s.id);
    [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]];
    reorderStatuses(backlogId, ids);
  };

  const moveDown = async (index: number) => {
    await materializeStatuses(backlogId);
    const cur = useBacklogStatusesStore.getState().statusesByBacklog[backlogId] ?? [];
    if (index === cur.length - 1) return;
    const ids = cur.map((s) => s.id);
    [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]];
    reorderStatuses(backlogId, ids);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>Statuses — {backlogName}</DialogTitle>
          <DialogDescription>
            Statuses are the board columns for this backlog. Add, rename, reorder, or
            remove them below. Statuses marked with a lock icon are required and cannot
            be edited or removed.
          </DialogDescription>
        </DialogHeader>

        {isInherited && inheritedFromName && (
          <div className="rounded-md border border-dashed border-muted-foreground/30 bg-muted/30 px-3 py-2 text-xs">
            <span className="text-muted-foreground">
              Inherited from <span className="font-medium text-foreground">{inheritedFromName}</span>.
              Any edit here will create a copy for this backlog.
            </span>
          </div>
        )}

        <div className="space-y-3">
          {list.map((s, idx) => (
            <StatusRow
              key={s.id}
              status={s}
              isFirst={idx === 0}
              isLast={idx === list.length - 1}
              locked={isPinnedStatus(s.key)}
              onLabel={(label) => updateStatus(backlogId, s.id, { label })}
              onColor={(color) => updateStatus(backlogId, s.id, { color })}
              onUp={() => moveUp(idx)}
              onDown={() => moveDown(idx)}
              onDelete={() => deleteStatus(backlogId, s.id)}
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
  locked,
  onLabel,
  onColor,
  onUp,
  onDown,
  onDelete,
  canDelete,
}: {
  status: BacklogStatus;
  isFirst: boolean;
  isLast: boolean;
  locked: boolean;
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
        disabled={locked}
        className="w-8 h-8 rounded border border-input bg-background cursor-pointer shrink-0 disabled:cursor-not-allowed disabled:opacity-60"
        title={locked ? "Required status — only the label can be changed" : "Color"}
      />
      <Input
        value={label}
        onChange={(e) => setLabel(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") (e.target as HTMLInputElement).blur();
        }}
        className="flex-1"
        title={locked ? "Label can be renamed, but color and deletion are locked" : undefined}
      />
      {locked ? (
        <span title="Required status — only the label can be changed" className="shrink-0 inline-flex">
          <Lock className="w-4 h-4 text-muted-foreground" />
        </span>
      ) : (
        <>
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
            title={canDelete ? "Delete" : "Backlog must keep at least one status"}
          >
            <Trash2 className="w-4 h-4" />
          </Button>
        </>
      )}
    </div>
  );
}
