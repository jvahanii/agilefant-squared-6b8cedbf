import { useState, useEffect, useRef, useMemo } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { useAppStore } from "@/store/appStore";
import { ChevronRight } from "lucide-react";
import { DEFAULT_TREE_STATUSES } from "@/store/treeStatusesStore";

const DEFAULT_STATUS_COLOR = "#94a3b8";
const BREADCRUMB_MAX_WIDTH = "max-w-[120px]";

interface MoveToParentDialogProps {
  /** The IDs of items that will be reparented. */
  workItemIds: string[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function MoveToParentDialog({ workItemIds, open, onOpenChange }: MoveToParentDialogProps) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const reparentWorkItem = useAppStore((s) => s.reparentWorkItem);

  const [query, setQuery] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  // Focus the search input when the dialog opens.
  useEffect(() => {
    if (open) {
      setQuery("");
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
          backlogPath,
          ancestors,
          treeName: tree?.name ?? "",
        };
      })
      .filter((r) => r.treeId)
      .sort((a, b) => a.item.title.localeCompare(b.item.title));
  }, [query, workItems, excludedIds, backlogs, backlogTrees]);

  const handleSelect = (newParentId: string | null) => {
    workItemIds.forEach((id) => reparentWorkItem(id, newParentId));
    onOpenChange(false);
  };

  const movingTitle =
    workItemIds.length === 1
      ? (workItems[workItemIds[0]]?.title ?? "item")
      : `${workItemIds.length} items`;

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg p-0 gap-0 overflow-hidden">
        <DialogHeader className="px-4 pt-4 pb-2">
          <DialogTitle className="text-sm font-semibold">
            Move &ldquo;{movingTitle}&rdquo; under parent
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
            onKeyDown={(e) => {
              if (e.key === "Escape") onOpenChange(false);
            }}
          />
        </div>

        {/* Move to root option */}
        <div className="px-2 pb-1">
          <button
            className="w-full flex items-center gap-2 px-3 py-1.5 rounded-md text-left text-sm hover:bg-accent/60 transition-colors text-muted-foreground italic"
            onClick={() => handleSelect(null)}
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
              {candidates.map(({ item, treeName, backlogPath, ancestors }) => {
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
                    className="flex items-start gap-2 px-4 py-1.5 text-left hover:bg-accent/60 transition-colors border-b border-border/20 last:border-b-0"
                    onClick={() => handleSelect(item.id)}
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
      </DialogContent>
    </Dialog>
  );
}
