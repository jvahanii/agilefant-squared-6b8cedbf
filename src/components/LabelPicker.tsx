import { useState, useRef, useEffect, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Plus, X } from "lucide-react";
import { useLabelsStore, LabelEntityType } from "@/store/labelsStore";
import { useOrgStore } from "@/store/orgStore";

interface LabelPickerProps {
  entityType: LabelEntityType;
  entityId: string;
  /** The trigger element (e.g. a button) that opens the popover. */
  children: React.ReactNode;
}

export function LabelPicker({ entityType, entityId, children }: LabelPickerProps) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const labelsMap = useLabelsStore((s) => s.labels);
  const assignments = useLabelsStore((s) => s.assignments);
  const assignLabel = useLabelsStore((s) => s.assignLabel);
  const unassignLabel = useLabelsStore((s) => s.unassignLabel);
  const createLabel = useLabelsStore((s) => s.createLabel);

  const orgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [labelsMap, activeOrgId],
  );

  const assignedIds = useMemo(
    () =>
      new Set(
        Object.values(assignments)
          .filter((a) => a.entityType === entityType && a.entityId === entityId)
          .map((a) => a.labelId),
      ),
    [assignments, entityType, entityId],
  );

  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const nameRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isCreating) nameRef.current?.focus();
  }, [isCreating]);

  const handleToggle = (labelId: string, orgId: string) => {
    if (assignedIds.has(labelId)) {
      unassignLabel(labelId, entityType, entityId);
    } else {
      assignLabel(labelId, entityType, entityId, orgId);
    }
  };

  const handleCreate = async () => {
    if (!activeOrgId || !newName.trim()) return;
    const label = await createLabel(activeOrgId, newName.trim(), newColor);
    if (label) {
      assignLabel(label.id, entityType, entityId, activeOrgId);
    }
    setNewName("");
    setIsCreating(false);
  };

  return (
    <Popover>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-52 p-1"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-medium text-muted-foreground px-2 py-1">Labels</div>

        {orgLabels.length === 0 && !isCreating && (
          <p className="text-xs text-muted-foreground text-center py-3 px-2">
            No labels yet. Create one below.
          </p>
        )}

        <div className="max-h-48 overflow-y-auto">
          {orgLabels.map((label) => (
            <button
              key={label.id}
              className="flex items-center gap-2 w-full px-2 py-1.5 rounded hover:bg-muted text-sm text-left"
              onClick={() => handleToggle(label.id, label.organizationId)}
            >
              <span
                className="w-3 h-3 rounded-full shrink-0"
                style={{ backgroundColor: label.color }}
              />
              <span className="flex-1 truncate">{label.name}</span>
              {assignedIds.has(label.id) && (
                <Check className="w-3.5 h-3.5 text-primary shrink-0" />
              )}
            </button>
          ))}
        </div>

        {isCreating ? (
          <div className="px-2 py-2 space-y-2 border-t mt-1">
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={newColor}
                onChange={(e) => setNewColor(e.target.value)}
                className="w-6 h-6 rounded cursor-pointer border-0 p-0 bg-transparent shrink-0"
              />
              <input
                ref={nameRef}
                className="flex-1 text-xs bg-transparent border-b border-primary/40 outline-none px-1 py-0.5"
                placeholder="Label name…"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleCreate();
                  if (e.key === "Escape") setIsCreating(false);
                }}
              />
              <button
                className="text-muted-foreground hover:text-foreground"
                onClick={() => setIsCreating(false)}
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
            <button
              className="w-full text-xs text-center py-1 rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
              disabled={!newName.trim()}
              onClick={handleCreate}
            >
              Create & assign
            </button>
          </div>
        ) : (
          <button
            className="flex items-center gap-1.5 w-full px-2 py-1.5 rounded hover:bg-muted text-xs text-muted-foreground border-t mt-1"
            onClick={() => setIsCreating(true)}
          >
            <Plus className="w-3 h-3" /> New label
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
