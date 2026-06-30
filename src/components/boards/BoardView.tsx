import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAppStore } from "@/store/appStore";
import { useBoardsStore, classifyItemIntoColumn, type Board, type BoardColumn } from "@/store/boardsStore";
import { Button } from "@/components/ui/button";
import { Pencil, ArrowLeft } from "lucide-react";
import { WORK_ITEM_STATUSES, type WorkItem, type WorkItemStatus } from "@/types/models";
import { BoardEditorDialog } from "./BoardEditorDialog";
interface Props {
  board: Board;
}

export function BoardView({ board }: Props) {
  const navigate = useNavigate();
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const setWorkItemStatus = useAppStore((s) => s.setWorkItemStatus);
  const renameWorkItem = useAppStore((s) => s.renameWorkItem);
  const selectWorkItem = useAppStore((s) => s.selectWorkItem);
  const selectTree = useAppStore((s) => s.selectTree);
  const selectBacklog = useAppStore((s) => s.selectBacklog);


  const columnsRaw = useBoardsStore((s) => s.columns);
  const columns = useMemo(
    () =>
      Object.values(columnsRaw)
        .filter((c) => c.boardId === board.id)
        .sort((a, b) => a.rank - b.rank),
    [columnsRaw, board.id],
  );
  const setCardRank = useBoardsStore((s) => s.setCardRank);
  const cardRanksByKey = useBoardsStore((s) => s.cardRanks);

  const [editorOpen, setEditorOpen] = useState(false);
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<string | null>(null);

  // Items that belong on this board.
  const items: WorkItem[] = useMemo(() => {
    const all = Object.values(workItems);
    if (board.scope === "tree" && board.treeId) {
      return all.filter((wi) => wi.backlogAssignments && board.treeId! in wi.backlogAssignments);
    }
    // custom scope
    const treeIds = board.filter.treeIds ?? [];
    const statuses = board.filter.statuses ?? [];
    const text = (board.filter.text ?? "").trim().toLowerCase();
    return all.filter((wi) => {
      if (wi.organizationId !== board.organizationId) {
        // include items in trees we have access to anyway when scope=custom
      }
      if (treeIds.length > 0 && !treeIds.some((tid) => tid in (wi.backlogAssignments ?? {}))) return false;
      if (statuses.length > 0 && !statuses.includes(wi.status)) return false;
      if (text && !wi.title.toLowerCase().includes(text)) return false;
      return true;
    });
  }, [workItems, board]);

  // Group items into columns.
  const columnItems = useMemo(() => {
    const map = new Map<string, WorkItem[]>();
    columns.forEach((c) => map.set(c.id, []));
    for (const wi of items) {
      const col = classifyItemIntoColumn(wi.status, columns);
      if (col) map.get(col.id)!.push(wi);
    }
    // sort each by saved card rank if present, else by title
    for (const [colId, list] of map) {
      list.sort((a, b) => {
        const ra = findCardRank(cardRanksByKey, board.id, colId, a.id);
        const rb = findCardRank(cardRanksByKey, board.id, colId, b.id);
        if (ra !== rb) return ra - rb;
        return a.title.localeCompare(b.title);
      });
    }
    return map;
  }, [items, columns, cardRanksByKey, board.id]);

  function openItem(wi: WorkItem) {
    // For a tree-scoped board, navigate to the item in its tree context.
    if (board.scope === "tree" && board.treeId) {
      selectTree(board.treeId);
      const backlogId = wi.backlogAssignments?.[board.treeId];
      if (backlogId) selectBacklog(backlogId, board.treeId);
      selectWorkItem(wi.id);
      navigate("/");
      return;
    }
    // Custom-scope: open in the first tree where the item lives.
    const firstTree = Object.keys(wi.backlogAssignments ?? {})[0];
    if (firstTree) {
      selectTree(firstTree);
      selectBacklog(wi.backlogAssignments[firstTree], firstTree);
    }
    selectWorkItem(wi.id);
    navigate("/");
  }

  async function handleDrop(colId: string) {
    if (!draggingId) return;
    const wi = workItems[draggingId];
    setDraggingId(null);
    setDragOverCol(null);
    if (!wi) return;
    const targetCol = columns.find((c) => c.id === colId);
    if (!targetCol) return;
    // Pick the first status from the column rule and apply it.
    const statuses = targetCol.rule.statuses ?? [];
    if (statuses.length > 0 && !statuses.includes(wi.status)) {
      setWorkItemStatus(wi.id, statuses[0]);
    }
    // Append to end of target column by rank = max+1
    const existing = columnItems.get(colId) ?? [];
    const nextRank = existing.length;
    await setCardRank({
      boardId: board.id,
      columnId: colId,
      workItemId: wi.id,
      organizationId: board.organizationId,
      rank: nextRank,
    });
  }

  return (
    <div className="h-full flex flex-col">
      <div className="px-3 py-2 border-b flex items-center gap-2 bg-background shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/boards")}>
          <ArrowLeft className="w-4 h-4 mr-1" /> Boards
        </Button>
        <h2 className="text-base font-semibold truncate">{board.name}</h2>
        <span className="text-xs text-muted-foreground">
          {board.scope === "tree" ? "Tree-scoped" : "Custom"} · {items.length} item{items.length === 1 ? "" : "s"}
        </span>
        <div className="ml-auto">
          <Button variant="outline" size="sm" onClick={() => setEditorOpen(true)}>
            <Pencil className="w-3.5 h-3.5 mr-1" /> Edit
          </Button>
        </div>
      </div>

      <div className="flex-1 min-h-0 overflow-x-auto overflow-y-hidden">
        <div className="flex h-full gap-3 p-3 min-w-fit">
          {columns.map((col) => {
            const list = columnItems.get(col.id) ?? [];
            return (
              <div
                key={col.id}
                className={`w-72 shrink-0 flex flex-col rounded-md border bg-card/40 transition-colors ${dragOverCol === col.id ? "ring-2 ring-primary/60" : ""}`}
                onDragOver={(e) => { e.preventDefault(); setDragOverCol(col.id); }}
                onDragLeave={() => setDragOverCol((c) => (c === col.id ? null : c))}
                onDrop={(e) => { e.preventDefault(); handleDrop(col.id); }}
              >
                <div className="px-2 py-1.5 border-b flex items-center gap-2 shrink-0">
                  <span className="w-2.5 h-2.5 rounded-full" style={{ background: col.color }} />
                  <span className="text-sm font-medium truncate flex-1">{col.name}</span>
                  <span className="text-xs text-muted-foreground tabular-nums">{list.length}</span>
                </div>
                <div className="flex-1 min-h-0 overflow-y-auto p-2 space-y-2">
                  {list.map((wi) => (
                    <BoardCard
                      key={wi.id}
                      wi={wi}
                      onClick={() => openItem(wi)}
                      onTitleChange={(t) => renameWorkItem(wi.id, t)}
                      onDragStart={() => setDraggingId(wi.id)}
                      onDragEnd={() => { setDraggingId(null); setDragOverCol(null); }}
                    />
                  ))}
                  {list.length === 0 && (
                    <div className="text-xs text-muted-foreground/60 italic py-4 text-center">drop here</div>
                  )}
                </div>
              </div>
            );
          })}
          {columns.length === 0 && (
            <div className="m-4 text-sm text-muted-foreground">
              No columns yet. <button className="underline" onClick={() => setEditorOpen(true)}>Edit board</button> to add some.
            </div>
          )}
        </div>
      </div>

      <BoardEditorDialog
        open={editorOpen}
        onOpenChange={setEditorOpen}
        organizationId={board.organizationId}
        boardId={board.id}
      />
    </div>
  );
}

function findCardRank(
  cardRanks: Record<string, { boardId: string; columnId: string; workItemId: string; rank: number }>,
  boardId: string,
  columnId: string,
  workItemId: string,
): number {
  for (const r of Object.values(cardRanks)) {
    if (r.boardId === boardId && r.columnId === columnId && r.workItemId === workItemId) return r.rank;
  }
  return Number.POSITIVE_INFINITY;
}

function BoardCard({
  wi,
  onClick,
  onTitleChange,
  onDragStart,
  onDragEnd,
}: {
  wi: WorkItem;
  onClick: () => void;
  onTitleChange: (t: string) => void;
  onDragStart: () => void;
  onDragEnd: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(wi.title);
  const statusMeta = WORK_ITEM_STATUSES.find((s) => s.value === wi.status);
  return (
    <div
      draggable={!editing}
      onDragStart={onDragStart}
      onDragEnd={onDragEnd}
      onClick={(e) => {
        if (editing) return;
        if ((e.target as HTMLElement).tagName === "INPUT") return;
        onClick();
      }}
      onDoubleClick={(e) => { e.stopPropagation(); setDraftTitle(wi.title); setEditing(true); }}
      className="bg-card border rounded-md p-2 shadow-sm hover:shadow transition-shadow cursor-grab active:cursor-grabbing text-sm"
    >
      {editing ? (
        <input
          autoFocus
          value={draftTitle}
          onChange={(e) => setDraftTitle(e.target.value)}
          onBlur={() => { setEditing(false); if (draftTitle.trim() && draftTitle !== wi.title) onTitleChange(draftTitle.trim()); }}
          onKeyDown={(e) => {
            if (e.key === "Enter") { e.preventDefault(); (e.target as HTMLInputElement).blur(); }
            if (e.key === "Escape") { setDraftTitle(wi.title); setEditing(false); }
          }}
          className="w-full bg-transparent border-b border-primary/40 outline-none text-sm"
        />
      ) : (
        <div className="line-clamp-3 leading-snug">{wi.title}</div>
      )}
      <div className="mt-1.5 flex items-center gap-1.5 text-[10px] text-muted-foreground">
        <span
          className="px-1.5 py-0.5 rounded-full"
          style={{ background: statusMeta?.color ? `${statusMeta.color}` : "transparent", color: "var(--foreground)" }}
        >
          {statusMeta?.label ?? wi.status}
        </span>
        {wi.points !== undefined && <span className="px-1.5 py-0.5 rounded-full bg-muted">{wi.points} pts</span>}
      </div>
    </div>
  );
}
