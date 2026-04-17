import { useState, useRef, useEffect, useMemo } from "react";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Check, Minus, Plus, Search, X } from "lucide-react";
import { useLabelsStore, LabelEntityType } from "@/store/labelsStore";
import { useOrgStore } from "@/store/orgStore";

interface LabelPickerProps {
  entityType: LabelEntityType;
  entityId: string;
  /**
   * When provided, all label toggle operations apply to every ID in this array
   * (bulk multi-select mode). Falls back to the single `entityId` when absent.
   */
  entityIds?: string[];
  /** The trigger element (e.g. a button) that opens the popover. */
  children: React.ReactNode;
}

export function LabelPicker({ entityType, entityId, entityIds, children }: LabelPickerProps) {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const assignLabel = useLabelsStore((s) => s.assignLabel);
  const unassignLabel = useLabelsStore((s) => s.unassignLabel);
  const createLabel = useLabelsStore((s) => s.createLabel);

  // Resolved list of IDs this picker operates on
  const resolvedIds = useMemo(
    () => (entityIds && entityIds.length > 0 ? entityIds : [entityId]),
    [entityIds, entityId],
  );
  const isBulk = resolvedIds.length > 1;

  const orgLabels = useMemo(
    () =>
      Object.values(labelsMap)
        .filter((l) => l.organizationId === activeOrgId)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [labelsMap, activeOrgId],
  );

  // O(1) lookup via byEntity index instead of O(n) assignment scan
  // In single-entity mode: a Set of assigned label IDs.
  // In bulk mode: keep a per-entity map for partial-state detection.
  const assignedIds = useMemo(
    () => new Set(byEntity[`${entityType}:${entityId}`] ?? []),
    [byEntity, entityType, entityId],
  );

  // For bulk mode: count how many of the selected entities have each label
  const bulkAssignedCounts = useMemo(() => {
    if (!isBulk) return null;
    const counts: Record<string, number> = {};
    for (const id of resolvedIds) {
      for (const labelId of byEntity[`${entityType}:${id}`] ?? []) {
        counts[labelId] = (counts[labelId] ?? 0) + 1;
      }
    }
    return counts;
  }, [isBulk, resolvedIds, byEntity, entityType]);

  const [isOpen, setIsOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newColor, setNewColor] = useState("#6366f1");
  const [focusedIdx, setFocusedIdx] = useState(-1);
  const searchRef = useRef<HTMLInputElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  // Reset transient state when popover opens / closes
  useEffect(() => {
    if (isOpen) {
      setSearchQuery("");
      setIsCreating(false);
      setNewName("");
      setNewColor("#6366f1");
      setFocusedIdx(-1);
      // Defer focus so the popover has time to mount
      setTimeout(() => searchRef.current?.focus(), 0);
    }
  }, [isOpen]);

  useEffect(() => {
    if (isCreating) nameRef.current?.focus();
  }, [isCreating]);

  const filteredLabels = useMemo(
    () =>
      searchQuery.trim()
        ? orgLabels.filter((l) =>
            l.name.toLowerCase().includes(searchQuery.toLowerCase()),
          )
        : orgLabels,
    [orgLabels, searchQuery],
  );

  // Reset focused index when the filtered list changes
  useEffect(() => {
    setFocusedIdx(-1);
  }, [searchQuery]);

  const handleToggle = (labelId: string, orgId: string) => {
    if (isBulk && bulkAssignedCounts) {
      const assignedCount = bulkAssignedCounts[labelId] ?? 0;
      if (assignedCount === resolvedIds.length) {
        // All have it → remove from all
        resolvedIds.forEach((id) => unassignLabel(labelId, entityType, id));
      } else {
        // Some or none have it → assign to all (assignLabel is idempotent)
        resolvedIds.forEach((id) => assignLabel(labelId, entityType, id, orgId));
      }
    } else {
      if (assignedIds.has(labelId)) {
        unassignLabel(labelId, entityType, entityId);
      } else {
        assignLabel(labelId, entityType, entityId, orgId);
      }
    }
  };

  const handleCreate = async () => {
    if (!activeOrgId || !newName.trim()) return;
    const label = await createLabel(activeOrgId, newName.trim(), newColor);
    if (label) {
      if (isBulk) {
        resolvedIds.forEach((id) => assignLabel(label.id, entityType, id, activeOrgId));
      } else {
        assignLabel(label.id, entityType, entityId, activeOrgId);
      }
    }
    setNewName("");
    setIsCreating(false);
  };

  const handleSearchKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (isCreating) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setFocusedIdx((i) => (i + 1) % Math.max(filteredLabels.length, 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setFocusedIdx((i) => (i <= 0 ? filteredLabels.length - 1 : i - 1));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (focusedIdx >= 0 && focusedIdx < filteredLabels.length) {
        const label = filteredLabels[focusedIdx];
        handleToggle(label.id, label.organizationId);
      }
    }
  };

  return (
    <Popover open={isOpen} onOpenChange={setIsOpen}>
      <PopoverTrigger asChild>{children}</PopoverTrigger>
      <PopoverContent
        className="w-56 p-1"
        align="start"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="text-xs font-medium text-muted-foreground px-2 py-1">
          {isBulk ? `Labels (${resolvedIds.length} items)` : "Labels"}
        </div>

        {/* Search input */}
        {!isCreating && (
          <div className="px-2 pb-1">
            <div className="flex items-center gap-1 rounded border border-input bg-background px-1.5 py-0.5">
              <Search className="w-3 h-3 text-muted-foreground shrink-0" />
              <input
                ref={searchRef}
                className="flex-1 text-xs bg-transparent outline-none placeholder:text-muted-foreground/50"
                placeholder="Search labels…"
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={handleSearchKeyDown}
              />
              {searchQuery && (
                <button
                  className="text-muted-foreground hover:text-foreground"
                  onClick={() => setSearchQuery("")}
                >
                  <X className="w-3 h-3" />
                </button>
              )}
            </div>
          </div>
        )}

        {filteredLabels.length === 0 && !isCreating && (
          <p className="text-xs text-muted-foreground text-center py-3 px-2">
            {searchQuery ? "No matching labels." : "No labels yet. Create one below."}
          </p>
        )}

        <div className="max-h-48 overflow-y-auto">
          {filteredLabels.map((label, idx) => {
            const fullyAssigned = isBulk
              ? (bulkAssignedCounts?.[label.id] ?? 0) === resolvedIds.length
              : assignedIds.has(label.id);
            const partiallyAssigned = isBulk
              ? (bulkAssignedCounts?.[label.id] ?? 0) > 0 && !fullyAssigned
              : false;
            return (
              <button
                key={label.id}
                className={`flex items-center gap-2 w-full px-2 py-1.5 rounded text-sm text-left transition-colors ${
                  idx === focusedIdx ? "bg-accent" : "hover:bg-muted"
                }`}
                onMouseEnter={() => setFocusedIdx(idx)}
                onClick={() => handleToggle(label.id, label.organizationId)}
              >
                <span
                  className="w-3 h-3 rounded-full shrink-0"
                  style={{ backgroundColor: label.color }}
                />
                <span className="flex-1 truncate">{label.name}</span>
                {fullyAssigned && (
                  <Check className="w-3.5 h-3.5 text-primary shrink-0" />
                )}
                {partiallyAssigned && (
                  <Minus className="w-3.5 h-3.5 text-muted-foreground shrink-0" />
                )}
              </button>
            );
          })}
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
            onClick={() => {
              setIsCreating(true);
              setSearchQuery("");
            }}
          >
            <Plus className="w-3 h-3" /> New label
          </button>
        )}
      </PopoverContent>
    </Popover>
  );
}
