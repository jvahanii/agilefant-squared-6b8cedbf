import { useState, useMemo } from "react";
import { useLabelsStore } from "@/store/labelsStore";
import { useOrgStore } from "@/store/orgStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Pencil, Plus, Trash2, Check, X } from "lucide-react";
import { toast } from "@/hooks/use-toast";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

export function LabelsManager() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const labelsMap = useLabelsStore((s) => s.labels);
  const createLabel = useLabelsStore((s) => s.createLabel);
  const updateLabel = useLabelsStore((s) => s.updateLabel);
  const deleteLabel = useLabelsStore((s) => s.deleteLabel);

  const labels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [labelsMap, activeOrgId],
  );

  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");

  const [editingId, setEditingId] = useState<string | null>(null);
  const [editName, setEditName] = useState("");
  const [editColor, setEditColor] = useState("");

  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);
  const confirmDeleteLabel = confirmDeleteId ? labelsMap[confirmDeleteId] : null;

  const handleAdd = async () => {
    if (!activeOrgId || !newName.trim()) return;
    const label = await createLabel(activeOrgId, newName.trim(), newColor);
    if (label) {
      toast({ title: "Label created" });
    }
    setNewName("");
    setNewColor("#6366f1");
    setIsAdding(false);
  };

  const startEdit = (id: string, name: string, color: string) => {
    setEditingId(id);
    setEditName(name);
    setEditColor(color);
  };

  const handleSaveEdit = async () => {
    if (!editingId) return;
    await updateLabel(editingId, { name: editName, color: editColor });
    setEditingId(null);
  };

  const handleConfirmDelete = async () => {
    if (!confirmDeleteId) return;
    await deleteLabel(confirmDeleteId);
    toast({ title: "Label deleted" });
    setConfirmDeleteId(null);
  };

  return (
    <div className="space-y-2">
      {labels.length === 0 && !isAdding && (
        <p className="text-sm text-muted-foreground">No labels yet.</p>
      )}

      {labels.map((label) =>
        editingId === label.id ? (
          <div key={label.id} className="flex items-center gap-2 py-1">
            <input
              type="color"
              value={editColor}
              onChange={(e) => setEditColor(e.target.value)}
              className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
            />
            <Input
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="h-7 text-sm flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") handleSaveEdit();
                if (e.key === "Escape") setEditingId(null);
              }}
              autoFocus
            />
            <Button variant="ghost" size="icon" className="h-7 w-7 shrink-0" onClick={handleSaveEdit}>
              <Check className="w-3.5 h-3.5" />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 shrink-0"
              onClick={() => setEditingId(null)}
            >
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div key={label.id} className="flex items-center gap-2 py-1 group">
            <span
              className="w-4 h-4 rounded-full shrink-0"
              style={{ backgroundColor: label.color }}
            />
            <span className="text-sm flex-1 font-bold">{label.name}</span>
            <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity">
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7"
                onClick={() => startEdit(label.id, label.name, label.color)}
              >
                <Pencil className="w-3.5 h-3.5" />
              </Button>
              <Button
                variant="ghost"
                size="icon"
                className="h-7 w-7 text-destructive hover:text-destructive"
                onClick={() => setConfirmDeleteId(label.id)}
              >
                <Trash2 className="w-3.5 h-3.5" />
              </Button>
            </div>
          </div>
        ),
      )}

      {isAdding ? (
        <div className="flex items-center gap-2 py-1">
          <input
            type="color"
            value={newColor}
            onChange={(e) => setNewColor(e.target.value)}
            className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
          />
          <Input
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            className="h-7 text-sm flex-1"
            placeholder="Label name…"
            onKeyDown={(e) => {
              if (e.key === "Enter") handleAdd();
              if (e.key === "Escape") setIsAdding(false);
            }}
            autoFocus
          />
          <Button size="sm" className="h-7 shrink-0" onClick={handleAdd} disabled={!newName.trim()}>
            Add
          </Button>
          <Button variant="ghost" size="sm" className="h-7 shrink-0" onClick={() => setIsAdding(false)}>
            Cancel
          </Button>
        </div>
      ) : (
        <Button variant="outline" size="sm" className="mt-1" onClick={() => setIsAdding(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> New label
        </Button>
      )}

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(open) => { if (!open) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete label "{confirmDeleteLabel?.name}"?</AlertDialogTitle>
            <AlertDialogDescription>
              This will permanently remove the label and all its assignments from every work item and
              backlog in this organization. This action cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction
              className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
              onClick={handleConfirmDelete}
            >
              Delete
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
