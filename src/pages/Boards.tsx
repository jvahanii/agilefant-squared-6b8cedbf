import { useEffect, useMemo, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useOrgStore } from "@/store/orgStore";
import { useAppStore } from "@/store/appStore";
import { useBoardsStore } from "@/store/boardsStore";
import { isBoardsEnabled } from "@/store/orgSettingsStore";
import { Button } from "@/components/ui/button";
import { Plus, LayoutDashboard, Trash2, ArrowLeft } from "lucide-react";
import { BoardEditorDialog } from "@/components/boards/BoardEditorDialog";
import { BoardView } from "@/components/boards/BoardView";
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

export default function Boards() {
  const navigate = useNavigate();
  const { boardId } = useParams<{ boardId?: string }>();
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const boards = useBoardsStore((s) => s.boards);
  const loaded = useBoardsStore((s) => s.loaded);
  const load = useBoardsStore((s) => s.load);
  const deleteBoard = useBoardsStore((s) => s.deleteBoard);

  const [editorOpen, setEditorOpen] = useState(false);
  const [confirmDeleteId, setConfirmDeleteId] = useState<string | null>(null);

  useEffect(() => {
    if (!activeOrgId) return;
    const orgIds = new Set<string>([activeOrgId]);
    for (const treeId of Object.keys(backlogTrees)) {
      const sep = treeId.indexOf("::");
      if (sep > 0) orgIds.add(treeId.slice(0, sep));
    }
    load([...orgIds]);
  }, [activeOrgId, backlogTrees, load]);

  const enabled = activeOrgId ? isBoardsEnabled(activeOrgId) : false;
  const orgBoards = useMemo(
    () => Object.values(boards).filter((b) => b.organizationId === activeOrgId).sort((a, b) => a.rank - b.rank),
    [boards, activeOrgId],
  );

  if (boardId) {
    const board = boards[boardId];
    if (!loaded) {
      return <div className="p-6 text-sm text-muted-foreground">Loading…</div>;
    }
    if (!board) {
      return (
        <div className="p-6 space-y-3">
          <Button variant="ghost" size="sm" onClick={() => navigate("/boards")}><ArrowLeft className="w-4 h-4 mr-1" /> Back</Button>
          <p className="text-sm text-muted-foreground">Board not found.</p>
        </div>
      );
    }
    return <div className="h-screen flex flex-col"><BoardView board={board} /></div>;
  }

  if (!enabled) {
    return (
      <div className="p-6 max-w-xl mx-auto text-center space-y-3">
        <LayoutDashboard className="w-8 h-8 mx-auto text-muted-foreground" />
        <h1 className="text-lg font-semibold">Boards are disabled</h1>
        <p className="text-sm text-muted-foreground">
          Enable the Boards lab in Bells &amp; Whistles to start configuring board views.
        </p>
        <div className="flex justify-center gap-2">
          <Button variant="outline" onClick={() => navigate("/")}>Back</Button>
          <Button onClick={() => navigate("/settings/bells-whistles")}>Open settings</Button>
        </div>
      </div>
    );
  }

  return (
    <div className="h-screen flex flex-col">
      <header className="border-b px-4 py-3 flex items-center gap-3 shrink-0">
        <Button variant="ghost" size="sm" onClick={() => navigate("/")}><ArrowLeft className="w-4 h-4 mr-1" /> Home</Button>
        <h1 className="text-lg font-semibold flex items-center gap-2"><LayoutDashboard className="w-5 h-5" /> Boards</h1>
        <div className="ml-auto">
          <Button size="sm" onClick={() => setEditorOpen(true)}><Plus className="w-4 h-4 mr-1" /> New board</Button>
        </div>
      </header>
      <div className="flex-1 overflow-y-auto p-4">
        {orgBoards.length === 0 ? (
          <p className="text-sm text-muted-foreground">No boards yet. Create one to get started.</p>
        ) : (
          <ul className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 max-w-5xl">
            {orgBoards.map((b) => (
              <li key={b.id} className="border rounded-md p-3 bg-card hover:shadow transition-shadow">
                <div className="flex items-start gap-2">
                  <button className="flex-1 text-left" onClick={() => navigate(`/boards/${b.id}`)}>
                    <div className="font-medium">{b.name}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">
                      {b.scope === "tree" ? (b.treeId && backlogTrees[b.treeId]?.name) || "(missing tree)" : "Custom filter"}
                    </div>
                  </button>
                  <Button variant="ghost" size="icon" onClick={() => setConfirmDeleteId(b.id)}>
                    <Trash2 className="w-4 h-4" />
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {activeOrgId && (
        <BoardEditorDialog
          open={editorOpen}
          onOpenChange={setEditorOpen}
          organizationId={activeOrgId}
          onCreated={(id) => navigate(`/boards/${id}`)}
        />
      )}

      <AlertDialog open={!!confirmDeleteId} onOpenChange={(o) => { if (!o) setConfirmDeleteId(null); }}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete board?</AlertDialogTitle>
            <AlertDialogDescription>The board, its columns, and card ranks will be removed. Work items themselves are not affected.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={async () => { if (confirmDeleteId) await deleteBoard(confirmDeleteId); setConfirmDeleteId(null); }}>Delete</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
