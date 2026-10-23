import { useState } from "react";
import { FileText, Pencil } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { ContextMenuItem } from "@/components/ui/context-menu";

export function WorkItemDescriptionDialog({ workItemId, open, onOpenChange }: {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const [editing, setEditing] = useState(!item?.description);
  const [draft, setDraft] = useState(item?.description ?? "");
  if (!item) return null;

  const save = () => {
    useAppStore.getState().setWorkItemDescription(workItemId, draft);
    setEditing(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[calc(100%-2rem)] max-w-2xl max-h-[85dvh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Description</DialogTitle>
          <DialogDescription className="break-words">{item.title}</DialogDescription>
        </DialogHeader>
        {editing ? (
          <Textarea
            aria-label="Description"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            className="min-h-48 max-h-[50dvh] resize-y"
            autoFocus
            onKeyDown={(e) => {
              if ((e.ctrlKey || e.metaKey) && e.key === "Enter") { e.preventDefault(); save(); }
            }}
          />
        ) : (
          <div className="whitespace-pre-wrap break-words text-sm min-h-24 max-h-[50dvh] overflow-y-auto">
            {item.description || <span className="text-muted-foreground">No description</span>}
          </div>
        )}
        <DialogFooter className="gap-2">
          {editing ? (
            <>
              <Button variant="outline" onClick={() => { setDraft(item.description ?? ""); setEditing(false); }}>Cancel</Button>
              <Button onClick={save}>Save</Button>
            </>
          ) : (
            <>
              <Button variant="outline" onClick={() => onOpenChange(false)}>Close</Button>
              <Button onClick={() => { setDraft(item.description ?? ""); setEditing(true); }}><Pencil className="h-4 w-4 mr-2" />Edit</Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

export function WorkItemDescriptionMenuItem({ onOpen }: { onOpen: () => void }) {
  return (
      <ContextMenuItem className="text-xs" onSelect={onOpen}>
        <FileText className="h-3 w-3 mr-2" />Description…
      </ContextMenuItem>
  );
}