import { useState, useEffect, useRef } from "react";
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

interface MoveToBacklogDialogProps {
  /** The IDs of work items to move. */
  workItemIds: string[];
  /** The tree in which the move takes place. */
  treeId: string;
  /** The backlog the items currently live in (excluded from the list). */
  currentBacklogId: string;
  /** All backlog IDs available in the current tree context. */
  allBacklogIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveToBacklogDialog({
  workItemIds,
  treeId,
  currentBacklogId,
  allBacklogIds,
  open,
  onOpenChange,
}: MoveToBacklogDialogProps) {
  const backlogs = useAppStore((s) => s.backlogs);
  const workItems = useAppStore((s) => s.workItems);
  const moveWorkItemToBacklog = useAppStore((s) => s.moveWorkItemToBacklog);
  const { isScrambled } = useScramble();

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (open) {
      setQuery("");
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  const movingTitle =
    workItemIds.length === 1
      ? (workItems[workItemIds[0]]?.title ?? "item")
      : `${workItemIds.length} items`;

  const candidates = allBacklogIds
    .filter((id) => id !== currentBacklogId)
    .map((id) => ({ id, name: backlogs[id]?.name ?? id }))
    .filter(({ name }) => {
      const q = query.trim().toLowerCase();
      return !q || name.toLowerCase().includes(q);
    })
    .sort((a, b) => a.name.localeCompare(b.name));

  const handleSelect = (targetBacklogId: string) => {
    workItemIds.forEach((id) => moveWorkItemToBacklog(id, targetBacklogId, treeId));
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-semibold">
            Move &ldquo;{movingTitle}&rdquo; to backlog
          </DialogTitle>
        </DialogHeader>

        {candidates.length > 5 && (
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
        )}

        <div className="overflow-y-auto max-h-72 border-t border-border/50">
          {candidates.length === 0 ? (
            <div className="flex items-center justify-center h-16 text-sm text-muted-foreground">
              No other backlogs available
            </div>
          ) : (
            <div className="flex flex-col">
              {candidates.map(({ id, name }) => (
                <button
                  key={id}
                  className="flex items-center gap-2 px-4 py-2 text-left text-sm hover:bg-accent/60 transition-colors border-b border-border/20 last:border-b-0"
                  onClick={() => handleSelect(id)}
                >
                  {isScrambled ? scrambleName(name) : name}
                </button>
              ))}
            </div>
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
}
