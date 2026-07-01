import { useMemo } from "react";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { useAppStore } from "@/store/appStore";
import { useTeamStore } from "@/store/teamStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useTreeStatusesStore, DEFAULT_TREE_STATUSES, type TreeStatus } from "@/store/treeStatusesStore";
import { WorkItem, WorkItemStatus } from "@/types/models";
import { cn } from "@/lib/utils";
import { Link2 } from "lucide-react";
import { useScramble } from "@/contexts/ScrambleContext";
import { scrambleName } from "@/lib/scramble";

interface BoardViewProps {
  backlogId: string;
  treeId: string;
}

const EMPTY_ARR: string[] = [];

/** Recursively collect this backlog and all descendant backlog IDs. */
function collectBacklogIds(
  rootId: string,
  backlogs: Record<string, { childrenIds: string[] }>,
): Set<string> {
  const out = new Set<string>();
  const walk = (id: string) => {
    if (out.has(id)) return;
    out.add(id);
    const bl = backlogs[id];
    if (!bl) return;
    for (const c of bl.childrenIds) walk(c);
  };
  walk(rootId);
  return out;
}

export function BoardView({ backlogId, treeId }: BoardViewProps) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const selectedWorkItemIds = useAppStore((s) => s.selectedWorkItemIds);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const statusesByTree = useTreeStatusesStore((s) => s.statusesByTree);

  const columns = useMemo<TreeStatus[]>(() => {
    const list = statusesByTree[treeId];
    if (list && list.length > 0) return list;
    return DEFAULT_TREE_STATUSES.map((s, i) => ({
      id: `default-${s.key}`,
      treeId,
      ...s,
      rank: i,
    })) as TreeStatus[];
  }, [statusesByTree, treeId]);

  const cardsByStatus = useMemo(() => {
    const backlogSet = collectBacklogIds(backlogId, backlogs);
    const known = new Set(columns.map((c) => c.key));
    const map: Record<string, WorkItem[]> = {};
    for (const c of columns) map[c.key] = [];
    const leaves: WorkItem[] = [];
    for (const wi of Object.values(workItems)) {
      const assigned = wi.backlogAssignments?.[treeId];
      if (!assigned || !backlogSet.has(assigned)) continue;
      if (wi.childrenIds.length > 0) continue; // leaf-only
      leaves.push(wi);
    }
    // Order by rank within their assigned backlog for deterministic display.
    leaves.sort((a, b) => {
      const ab = a.backlogAssignments[treeId];
      const bb = b.backlogAssignments[treeId];
      const ar = a.ranks?.[ab] ?? 0;
      const br = b.ranks?.[bb] ?? 0;
      return ar - br;
    });
    for (const wi of leaves) {
      const key = known.has(wi.status) ? wi.status : "not_started";
      (map[key] ??= []).push(wi);
    }
    return map;
  }, [workItems, backlogs, backlogId, treeId, columns]);

  return (
    <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden p-2">
      <div className="flex gap-2 h-full min-w-max">
        {columns.map((col) => (
          <BoardColumn
            key={col.id}
            column={col}
            items={cardsByStatus[col.key] ?? []}
            selectedIds={selectedWorkItemIds}
            onSelectItem={(id, ctrl) => selectWorkItem(id, ctrl)}
          />
        ))}
      </div>
    </div>
  );
}

function BoardColumn({
  column,
  items,
  selectedIds,
  onSelectItem,
}: {
  column: TreeStatus;
  items: WorkItem[];
  selectedIds: string[];
  onSelectItem: (id: string, ctrl: boolean) => void;
}) {
  const { setNodeRef, isOver } = useDroppable({
    id: `board-column:${column.id}`,
    data: { type: "board-column", statusKey: column.key },
  });
  return (
    <div
      className={cn(
        "flex flex-col w-64 shrink-0 rounded-lg border bg-muted/30 h-full",
        isOver && "ring-2 ring-primary bg-primary/5",
      )}
    >
      <div className="flex items-center gap-2 px-3 py-2 border-b sticky top-0 bg-muted/60 rounded-t-lg">
        <span
          className="w-2.5 h-2.5 rounded-full shrink-0"
          style={{ backgroundColor: column.color }}
        />
        <span className="text-sm font-semibold truncate">{column.label}</span>
        <span className="ml-auto text-xs tabular-nums text-muted-foreground">
          {items.length}
        </span>
      </div>
      <div ref={setNodeRef} className="flex-1 overflow-y-auto p-2 space-y-2">
        {items.map((wi) => (
          <BoardCard
            key={wi.id}
            item={wi}
            selected={selectedIds.includes(wi.id)}
            onClick={(ctrl) => onSelectItem(wi.id, ctrl)}
          />
        ))}
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-6">Drop here</div>
        )}
      </div>
    </div>
  );
}

function BoardCard({
  item,
  selected,
  onClick,
}: {
  item: WorkItem;
  selected: boolean;
  onClick: (ctrl: boolean) => void;
}) {
  const { attributes, listeners, setNodeRef, isDragging } = useDraggable({
    id: `board-card:${item.id}`,
    data: { type: "workitem", workItemId: item.id, selectedIds: [item.id] },
  });
  const workItemTeamsMap = useTeamStore((s) => s.workItemTeams);
  const teams = useTeamStore((s) => s.teams);
  const labelsMap = useLabelsStore((s) => s.labels);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const teamIds = useMemo(() => workItemTeamsMap[item.id] ?? EMPTY_ARR, [workItemTeamsMap, item.id]);
  const labels = useMemo(() => {
    const ids = byEntity[`work_item:${item.id}`] ?? EMPTY_ARR;
    return ids.map((id) => labelsMap[id]).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name));
  }, [byEntity, labelsMap, item.id]);
  const { scrambleEnabled } = useScramble();
  const title = scrambleEnabled ? scrambleName(item.title) : item.title;
  return (
    <div
      ref={setNodeRef}
      {...listeners}
      {...attributes}
      onClick={(e) => {
        e.stopPropagation();
        onClick(e.ctrlKey || e.metaKey);
      }}
      className={cn(
        "group rounded-md border bg-card shadow-sm p-2 cursor-grab active:cursor-grabbing text-sm",
        selected && "ring-2 ring-primary border-primary",
        isDragging && "opacity-40",
      )}
    >
      <div className="font-medium leading-snug break-words">{title}</div>
      <div className="flex flex-wrap items-center gap-1 mt-1.5">
        {typeof item.points === "number" && (
          <span className="text-[10px] font-semibold px-1.5 py-0.5 rounded bg-primary/10 text-primary tabular-nums">
            {item.points}p
          </span>
        )}
        {labels.map((l) => (
          <span
            key={l.id}
            className="text-[10px] px-1.5 py-0.5 rounded"
            style={{ backgroundColor: `${l.color}22`, color: l.color }}
          >
            {l.name}
          </span>
        ))}
        {teamIds.slice(0, 3).map((tid) => {
          const t = teams.find((x) => x.id === tid);
          if (!t) return null;
          const name = scrambleEnabled ? scrambleName(t.name) : t.name;
          return (
            <span
              key={tid}
              className="text-[10px] px-1.5 py-0.5 rounded bg-secondary text-secondary-foreground"
              title={name}
            >
              {name}
            </span>
          );
        })}
      </div>
    </div>
  );
}
