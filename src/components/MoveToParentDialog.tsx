import { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/appStore";
import { ChevronRight } from "lucide-react";
import { DEFAULT_TREE_STATUSES } from "@/store/treeStatusesStore";
import { toast } from "@/hooks/use-toast";

const DEFAULT_STATUS_COLOR = "#94a3b8";
const BREADCRUMB_MAX_WIDTH = "max-w-[120px]";

interface MoveToParentDialogProps {
  /** The IDs of items that will be reparented. */
  workItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

interface PendingCrossTreeParent {
  parentId: string;
  treeId: string;
  backlogId: string;
  treeName: string;
}

export function MoveToParentDialog({ workItemIds, open, onOpenChange }: MoveToParentDialogProps) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const reparentWorkItem = useAppStore((s) => s.reparentWorkItem);

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const itemRefs = useRef<(HTMLButtonElement | null)[]>([]);

  /** Set when the user selects a parent from a different tree; triggers the
   *  cross-tree choice view instead of immediately reparenting. */
  const [pendingCrossTree, setPendingCrossTree] = useState<PendingCrossTreeParent | null>(null);

  // Focus the search input when the dialog opens.
  useEffect(() => {
    if (open) {
      setQuery("");
      setPendingCrossTree(null);
      setTimeout(() => inputRef.current?.focus(), 50);
    }
  }, [open]);

  // Collect all descendant IDs of the items being moved so they are excluded
  // from the candidate list (to prevent circular hierarchies).
  const excludedIds = useMemo(() => {
    const excluded = new Set<string>(workItemIds);
    const visit = (id: string) => {
      const item = workItems[id];
      if (!item) return;
      item.childrenIds.forEach((childId) => {
        if (!excluded.has(childId)) {
          excluded.add(childId);
          visit(childId);
        }
      });
    };
    workItemIds.forEach(visit);
    return excluded;
  }, [workItemIds, workItems]);

  // Build the list of candidate parent items, each with its full breadcrumb.
  const candidates = useMemo(() => {
    const q = query.trim().toLowerCase();
    return Object.values(workItems)
      .filter((wi) => {
        if (excludedIds.has(wi.id)) return false;
        if (q && !wi.title.toLowerCase().includes(q)) return false;
        return true;
      })
      .map((wi) => {
        // Pick the first tree assignment for context.
        const treeIds = Object.keys(wi.backlogAssignments);
        const treeId = treeIds[0] ?? null;
        const backlogId = treeId ? wi.backlogAssignments[treeId] : null;
        const tree = treeId ? backlogTrees[treeId] : null;

        // Backlog ancestry path (root → leaf).
        const backlogPath: string[] = [];
        const visitedBl = new Set<string>();
        let bl = backlogId ? backlogs[backlogId] : null;
        while (bl && !visitedBl.has(bl.id)) {
          visitedBl.add(bl.id);
          backlogPath.unshift(bl.name);
          bl = bl.parentId ? backlogs[bl.parentId] : null;
        }

        // Work item ancestor chain (root ancestor → direct parent).
        const ancestors: string[] = [];
        const visitedWi = new Set<string>();
        let parent = wi.parentId ? workItems[wi.parentId] : null;
        while (parent && !visitedWi.has(parent.id)) {
          visitedWi.add(parent.id);
          ancestors.unshift(parent.title);
          parent = parent.parentId ? workItems[parent.parentId] : null;
        }

        return {
          item: wi,
          treeId: treeId ?? "",
          backlogId: backlogId ?? "",
          backlogPath,
          ancestors,
          treeName: tree?.name ?? "",
        };
      })
      .filter((r) => r.treeId)
      .sort((a, b) => a.item.title.localeCompare(b.item.title));
  }, [query, workItems, excludedIds, backlogs, backlogTrees]);

  // Trim stale refs when the candidates list shrinks.
  useEffect(() => {
    itemRefs.current = itemRefs.current.slice(0, candidates.length + 1);
  }, [candidates.length]);

  const focusItem = (index: number) => {
    const el = itemRefs.current[index];
    if (el) {
      el.focus();
      el.scrollIntoView({ block: "nearest" });
    }
  };

  // Total navigable items: root button (index 0) + one per candidate.
  const totalItems = candidates.length + 1;

  const handleInputKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Escape") {
      onOpenChange(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      focusItem(0);
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      focusItem(totalItems - 1);
    }
  };

  const handleItemKeyDown = (e: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (index === totalItems - 1) {
        inputRef.current?.focus();
      } else {
        focusItem(index + 1);
      }
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      if (index === 0) {
        inputRef.current?.focus();
      } else {
        focusItem(index - 1);
      }
    }
  };

  const handleSelect = (
    newParentId: string | null,
    parentTreeId?: string,
    parentBacklogId?: string,
    parentTreeName?: string,
  ) => {
    if (newParentId && parentTreeId && parentBacklogId) {
      // Check whether any of the items being moved is not yet in the parent's tree.
      const isCrossTree = workItemIds.some((id) => {
        const wi = workItems[id];
        return wi && !wi.backlogAssignments[parentTreeId];
      });

      if (isCrossTree) {
        setPendingCrossTree({
          parentId: newParentId,
          treeId: parentTreeId,
          backlogId: parentBacklogId,
          treeName: parentTreeName ?? "",
        });
        return;
      }
    }

    useAppStore.getState().runBulk(() => {
      workItemIds.forEach((id) => reparentWorkItem(id, newParentId, parentTreeId, parentBacklogId));
    });
    const newParentTitle = newParentId ? (workItems[newParentId]?.title ?? "item") : null;
    toast({
      title: newParentTitle
        ? workItemIds.length === 1
          ? `Reparented to "${newParentTitle}"`
          : `Reparented ${workItemIds.length} items to "${newParentTitle}"`
        : workItemIds.length === 1
          ? "Moved to root (no parent)"
          : `Moved ${workItemIds.length} items to root`,
    });
    onOpenChange(false);
  };

  const handleCrossTreeChoice = (strategy: "move-to-tree" | "mirror") => {
    if (!pendingCrossTree) return;
    const { parentId, treeId, backlogId } = pendingCrossTree;
    useAppStore.getState().runBulk(() => {
      workItemIds.forEach((id) =>
        reparentWorkItem(id, parentId, treeId, backlogId, strategy),
      );
    });
    const parentTitle = workItems[parentId]?.title ?? "item";
    toast({
      title: workItemIds.length === 1
        ? `Reparented to "${parentTitle}"`
        : `Reparented ${workItemIds.length} items to "${parentTitle}"`,
    });
    setPendingCrossTree(null);
    onOpenChange(false);
  };

  const handleDialogOpenChange = (v: boolean) => {
    if (!v) setPendingCrossTree(null);
    onOpenChange(v);
  };

  const movingTitle =
    workItemIds.length === 1
      ? (workItems[workItemIds[0]]?.title ?? "item")
      : `${workItemIds.length} items`;

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        {pendingCrossTree ? (
          /* ── Cross-tree choice view ── */
          <>
            <DialogHeader className="px-4 pt-4 pb-2">
              <DialogTitle className="text-sm font-semibold">
                Move to a different tree
              </DialogTitle>
            </DialogHeader>
            <div className="px-4 pb-4 text-sm text-muted-foreground space-y-3">
              <p>
                The selected parent is in tree{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{pendingCrossTree.treeName}&rdquo;
                </span>
                , which is different from the current tree of{" "}
                <span className="font-medium text-foreground">
                  &ldquo;{movingTitle}&rdquo;
                </span>
                . How would you like to proceed?
              </p>
            </div>
            <DialogFooter className="flex flex-col gap-2 px-4 pb-4 sm:flex-col">
              <Button
                className="w-full justify-start text-left"
                variant="default"
                onClick={() => handleCrossTreeChoice("move-to-tree")}
              >
                Move to &ldquo;{pendingCrossTree.treeName}&rdquo; completely
                <span className="ml-auto text-xs font-normal opacity-70">
                  Remove from original tree
                </span>
              </Button>
              <Button
                className="w-full justify-start text-left"
                variant="outline"
                onClick={() => handleCrossTreeChoice("mirror")}
              >
                Mirror under new parent
                <span className="ml-auto text-xs font-normal opacity-70">
                  Keep in original tree too
                </span>
              </Button>
              <Button
                className="w-full"
                variant="ghost"
                onClick={() => setPendingCrossTree(null)}
              >
                Cancel
              </Button>
            </DialogFooter>
          </>
        ) : (
          /* ── Normal search / list view ── */
          <>
            <DialogHeader className="px-4 pt-4 pb-2">
              <DialogTitle className="text-sm font-semibold">
                Reparent &ldquo;{movingTitle}&rdquo;
              </DialogTitle>
            </DialogHeader>

            {/* Search input */}
            <div className="px-4 pb-2">
              <Input
                ref={inputRef}
                placeholder="Search for a parent item…"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                className="h-8 text-sm"
                onKeyDown={handleInputKeyDown}
              />
            </div>

            {/* Move to root option */}
            <div className="px-2 pb-1">
              <button
                ref={(el) => { itemRefs.current[0] = el; }}
                className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm hover:bg-accent/60 transition-colors text-muted-foreground italic"
                onClick={() => handleSelect(null)}
                onKeyDown={(e) => handleItemKeyDown(e, 0)}
              >
                Move to root (no parent)
              </button>
            </div>

            {/* Results list */}
            <div className="overflow-y-auto max-h-72 border-t border-border/50">
              {candidates.length === 0 ? (
                <div className="flex items-center justify-center h-20 text-sm text-muted-foreground">
                  No matching items
                </div>
              ) : (
                <div className="flex flex-col">
                  {candidates.map(({ item, treeId, backlogId, treeName, backlogPath, ancestors }, index) => {
                    const statusColor =
                      DEFAULT_TREE_STATUSES.find((s) => s.key === item.status)?.color ?? DEFAULT_STATUS_COLOR;
                    const q = query.trim().toLowerCase();
                    const titleLower = item.title.toLowerCase();
                    const matchIdx = q ? titleLower.indexOf(q) : -1;
                    const titleNode =
                      matchIdx >= 0 ? (
                        <>
                          {item.title.slice(0, matchIdx)}
                          <mark className="bg-primary/20 text-foreground rounded-sm px-0 not-italic">
                            {item.title.slice(matchIdx, matchIdx + q.length)}
                          </mark>
                          {item.title.slice(matchIdx + q.length)}
                        </>
                      ) : (
                        item.title
                      );

                    // Build breadcrumb: tree › backlog path › work item ancestors
                    const breadcrumbParts = [treeName, ...backlogPath];

                    return (
                      <button
                        key={item.id}
                        ref={(el) => { itemRefs.current[index + 1] = el; }}
                        className="flex items-start gap-2 px-4 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/20 last:border-b-0"
                        onClick={() => handleSelect(item.id, treeId, backlogId, treeName)}
                        onKeyDown={(e) => handleItemKeyDown(e, index + 1)}
                      >
                        <span
                          className="w-3 h-3 rounded-full shrink-0 mt-1 border border-background/50"
                          style={{ backgroundColor: statusColor }}
                          title={item.status}
                        />
                        <div className="min-w-0 flex-1">
                          <span className="text-sm leading-snug break-words">{titleNode}</span>
                          {/* Work item ancestors breadcrumb */}
                          {ancestors.length > 0 && (
                            <p className="flex items-center flex-wrap gap-0.5 text-[10px] text-muted-foreground/70 mt-0">
                              {ancestors.map((a, i) => (
                                <span key={i} className="flex items-center gap-0.5">
                                  {i > 0 && <ChevronRight className="w-2.5 h-2.5 opacity-40 shrink-0" />}
                                  <span className={`truncate ${BREADCRUMB_MAX_WIDTH}`}>{a}</span>
                                </span>
                              ))}
                            </p>
                          )}
                          {/* Backlog / tree breadcrumb */}
                          <p className="flex items-center flex-wrap gap-0.5 text-[10px] text-muted-foreground mt-0.5">
                            {breadcrumbParts.map((part, i) => (
                              <span key={i} className="flex items-center gap-0.5">
                                {i > 0 && <ChevronRight className="w-2.5 h-2.5 opacity-40 shrink-0" />}
                                <span className={`truncate ${BREADCRUMB_MAX_WIDTH}`}>{part}</span>
                              </span>
                            ))}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
