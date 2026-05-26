import { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/appStore";
import { useScramble } from "@/contexts/ScrambleContext";
import { scrambleName } from "@/lib/scramble";
import { ActionPrompt } from "./ActionPrompt";

interface MoveToBacklogDialogProps {
  /** The IDs of work items to move. */
  workItemIds: string[];
  /** The tree in which the move takes place (used as fallback). */
  treeId: string;
  /** The backlog the items currently live in (excluded from the list). */
  currentBacklogId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveToBacklogDialog({
  workItemIds,
  treeId,
  currentBacklogId,
  open,
  onOpenChange,
}: MoveToBacklogDialogProps) {
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const workItems = useAppStore((s) => s.workItems);
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const { scrambleEnabled: isScrambled } = useScramble();

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  type PendingSelection = {
    backlogId: string;
    targetTreeId: string;
    backlogName: string;
  };
  const [pendingSelection, setPendingSelection] = useState<PendingSelection | null>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setPendingSelection(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const movingTitle =
    workItemIds.length === 1
      ? (workItems[workItemIds[0]]?.title ?? "item")
      : `${workItemIds.length} items`;

  // Collect all backlog IDs the selected items are already assigned to.
  const assignedBacklogIds = useMemo(() => {
    const ids = new Set<string>();
    workItemIds.forEach((id) => {
      const wi = workItems[id];
      if (wi) Object.values(wi.backlogAssignments).forEach((blId) => ids.add(blId));
    });
    return ids;
  }, [workItemIds, workItems]);

  // Sort trees by rank so same-tree backlogs appear first.
  const sortedTrees = useMemo(
    () => Object.values(backlogTrees).sort((a, b) => (a.rank ?? 0) - (b.rank ?? 0)),
    [backlogTrees],
  );

  // The tree ID of the currently active context (for ordering: current tree first).
  const currentTreeId = backlogs[currentBacklogId]?.treeId ?? treeId;

  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    const result: Array<{ id: string; name: string; treeName: string; treeId: string; crossTree: boolean }> = [];
    sortedTrees.forEach((tree) => {
      const collectBacklog = (backlogId: string) => {
        const bl = backlogs[backlogId];
        if (!bl) return;
        if (!assignedBacklogIds.has(backlogId)) {
          const name = bl.name ?? backlogId;
          if (!q || name.toLowerCase().includes(q) || tree.name.toLowerCase().includes(q)) {
            result.push({
              id: backlogId,
              name,
              treeName: tree.name,
              treeId: tree.id,
              crossTree: tree.id !== currentTreeId,
            });
          }
        }
        bl.childrenIds.forEach(collectBacklog);
      };
      tree.rootBacklogIds.forEach(collectBacklog);
    });
    // Sort: same-tree backlogs first, then cross-tree; within each group alphabetically by name.
    return result.sort((a, b) => {
      if (a.crossTree !== b.crossTree) return a.crossTree ? 1 : -1;
      return a.name.localeCompare(b.name);
    });
  }, [backlogs, sortedTrees, assignedBacklogIds, query, currentTreeId]);

  const applySelection = (backlogId: string, targetTreeId: string, strategy: "move" | "mirror") => {
    useAppStore.getState().runBulk(() => {
      workItemIds.forEach((id) =>
        moveWorkItemToBacklog(id, backlogId, targetTreeId, strategy, strategy === "move" ? currentTreeId : undefined),
      );
    });
    onOpenChange(false);
  };

  const handleSelect = (backlogId: string, targetTreeId: string, crossTree: boolean, backlogName: string) => {
    if (crossTree) {
      // For cross-tree selections, ask the user whether to move or mirror.
      setPendingSelection({ backlogId, targetTreeId, backlogName });
    } else {
      applySelection(backlogId, targetTreeId, "move");
    }
  };

  const handleMoveOrMirrorChoice = (value: string) => {
    if (!pendingSelection) return;
    applySelection(pendingSelection.backlogId, pendingSelection.targetTreeId, value as "move" | "mirror");
    setPendingSelection(null);
  };

  const targetTreeName = pendingSelection
    ? (backlogTrees[pendingSelection.targetTreeId]?.name ?? pendingSelection.targetTreeId)
    : "";
  const sourceTreeName = backlogTrees[currentTreeId]?.name ?? currentTreeId;

  return (
    <>
      <Dialog open={open && !pendingSelection} onOpenChange={onOpenChange}>
        <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
          <DialogHeader className="px-4 pt-4 pb-2">
            <DialogTitle className="text-sm font-semibold">
              Move &ldquo;{movingTitle}&rdquo; to backlog
            </DialogTitle>
          </DialogHeader>

          <div className="px-4 pb-2">
            <Input
              ref={inputRef}
              placeholder="Search backlogs…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              className="h-8 text-sm"
              onKeyDown={(e) => {
                if (e.key === "Escape") onOpenChange(false);
              }}
            />
          </div>

          <div className="overflow-y-auto max-h-72 border-t border-border/50">
            {candidates.length === 0 ? (
              <div className="flex items-center justify-center h-16 text-sm text-muted-foreground">
                No other backlogs available
              </div>
            ) : (
              <div className="flex flex-col">
                {candidates.map(({ id, name, treeName, treeId: targetTreeId, crossTree }) => (
                  <button
                    key={id}
                    className="flex items-center justify-between gap-2 px-4 py-2 text-left text-sm hover:bg-accent/60 transition-colors border-b border-border/20 last:border-b-0"
                    onClick={() => handleSelect(id, targetTreeId, crossTree, name)}
                  >
                    <span>{isScrambled ? scrambleName(name) : name}</span>
                    {crossTree && (
                      <span className="text-xs text-muted-foreground shrink-0">
                        {isScrambled ? scrambleName(treeName) : treeName}
                      </span>
                    )}
                  </button>
                ))}
              </div>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {pendingSelection && (
        <ActionPrompt
          title={
            workItemIds.length > 1
              ? `Move ${workItemIds.length} items to ${isScrambled ? scrambleName(targetTreeName) : targetTreeName}`
              : `Move "${isScrambled ? scrambleName(movingTitle) : movingTitle}" to ${isScrambled ? scrambleName(targetTreeName) : targetTreeName}`
          }
          options={[
            {
              label: "Move",
              description: `Switch from ${isScrambled ? scrambleName(sourceTreeName) : sourceTreeName} to ${isScrambled ? scrambleName(targetTreeName) : targetTreeName}.`,
              value: "move",
              isDefault: true,
            },
            {
              label: "Mirror",
              description: `Keep in both tree views.`,
              value: "mirror",
            },
          ]}
          onSelect={handleMoveOrMirrorChoice}
          onCancel={() => {
            setPendingSelection(null);
            onOpenChange(false);
          }}
        />
      )}
    </>
  );
}
