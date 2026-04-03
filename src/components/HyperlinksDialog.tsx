import { useState, useEffect, useRef } from "react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { ExternalLink, Plus, Trash2, Pencil, Check, X } from "lucide-react";

interface HyperlinksDialogProps {
  workItemId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function HyperlinksDialog({
  workItemId,
  open,
  onOpenChange,
}: HyperlinksDialogProps) {
  const item = useAppStore((s) => s.workItems[workItemId]);
  const hyperlinks = useAppStore((s) => s.hyperlinks[workItemId] ?? []);
  const addHyperlink = useAppStore((s) => s.addHyperlink);
  const updateHyperlink = useAppStore((s) => s.updateHyperlink);
  const removeHyperlink = useAppStore((s) => s.removeHyperlink);

  const [isAdding, setIsAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newAltText, setNewAltText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editAltText, setEditAltText] = useState("");
  const urlInputRef = useRef<HTMLInputElement>(null);
  const editUrlRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (isAdding) {
      setTimeout(() => urlInputRef.current?.focus(), 0);
    }
  }, [isAdding]);

  useEffect(() => {
    if (editingId) {
      setTimeout(() => editUrlRef.current?.focus(), 0);
    }
  }, [editingId]);

  // Reset form when dialog closes
  useEffect(() => {
    if (!open) {
      setIsAdding(false);
      setNewUrl("");
      setNewAltText("");
      setEditingId(null);
    }
  }, [open]);

  if (!item) return null;

  const handleAdd = () => {
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) return;
    addHyperlink(workItemId, trimmedUrl, newAltText.trim());
    setNewUrl("");
    setNewAltText("");
    setIsAdding(false);
  };

  const handleStartEdit = (linkId: string, url: string, altText: string) => {
    setEditingId(linkId);
    setEditUrl(url);
    setEditAltText(altText);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    const trimmedUrl = editUrl.trim();
    if (!trimmedUrl) return;
    updateHyperlink(editingId, workItemId, trimmedUrl, editAltText.trim());
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md" onClick={(e) => e.stopPropagation()}>
        <DialogHeader>
          <DialogTitle>Hyperlinks</DialogTitle>
        </DialogHeader>
        <div className="text-sm text-muted-foreground mb-4 truncate" title={item.title}>
          {item.title}
        </div>

        {/* Existing hyperlinks */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {hyperlinks.length === 0 && !isAdding && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hyperlinks yet. Add one below.
            </p>
          )}
          {hyperlinks.map((link) =>
            editingId === link.id ? (
              <div key={link.id} className="space-y-2 p-2 rounded-md border bg-muted/30">
                <div className="space-y-1">
                  <Label className="text-xs">URL</Label>
                  <Input
                    ref={editUrlRef}
                    value={editUrl}
                    onChange={(e) => setEditUrl(e.target.value)}
                    placeholder="https://..."
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit();
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                  />
                </div>
                <div className="space-y-1">
                  <Label className="text-xs">Alt text</Label>
                  <Input
                    value={editAltText}
                    onChange={(e) => setEditAltText(e.target.value)}
                    placeholder="Description (optional)"
                    className="h-8 text-sm"
                    onKeyDown={(e) => {
                      if (e.key === "Enter") handleSaveEdit();
                      if (e.key === "Escape") handleCancelEdit();
                    }}
                  />
                </div>
                <div className="flex justify-end gap-1">
                  <Button variant="ghost" size="sm" onClick={handleCancelEdit}>
                    <X className="w-3.5 h-3.5 mr-1" /> Cancel
                  </Button>
                  <Button size="sm" onClick={handleSaveEdit} disabled={!editUrl.trim()}>
                    <Check className="w-3.5 h-3.5 mr-1" /> Save
                  </Button>
                </div>
              </div>
            ) : (
              <div
                key={link.id}
                className="flex items-center gap-2 p-2 rounded-md border hover:bg-muted/30 transition-colors group"
              >
                <ExternalLink className="w-3.5 h-3.5 shrink-0 text-muted-foreground" />
                <div className="flex-1 min-w-0">
                  <a
                    href={link.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-primary hover:underline truncate block"
                    title={link.url}
                  >
                    {link.altText || link.url}
                  </a>
                  {link.altText && (
                    <span className="text-xs text-muted-foreground truncate block" title={link.url}>
                      {link.url}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 transition-opacity shrink-0">
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-foreground hover:bg-accent transition-colors"
                    onClick={() => handleStartEdit(link.id, link.url, link.altText)}
                    title="Edit"
                  >
                    <Pencil className="w-3 h-3" />
                  </button>
                  <button
                    className="w-6 h-6 flex items-center justify-center rounded text-muted-foreground hover:text-destructive hover:bg-destructive/10 transition-colors"
                    onClick={() => removeHyperlink(link.id, workItemId)}
                    title="Remove"
                  >
                    <Trash2 className="w-3 h-3" />
                  </button>
                </div>
              </div>
            ),
          )}
        </div>

        {/* Add new hyperlink form */}
        {isAdding ? (
          <div className="space-y-2 p-2 rounded-md border border-dashed bg-muted/20 mt-2">
            <div className="space-y-1">
              <Label className="text-xs">URL</Label>
              <Input
                ref={urlInputRef}
                value={newUrl}
                onChange={(e) => setNewUrl(e.target.value)}
                placeholder="https://..."
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setIsAdding(false);
                }}
              />
            </div>
            <div className="space-y-1">
              <Label className="text-xs">Alt text</Label>
              <Input
                value={newAltText}
                onChange={(e) => setNewAltText(e.target.value)}
                placeholder="Description (optional)"
                className="h-8 text-sm"
                onKeyDown={(e) => {
                  if (e.key === "Enter") handleAdd();
                  if (e.key === "Escape") setIsAdding(false);
                }}
              />
            </div>
            <div className="flex justify-end gap-1">
              <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)}>
                Cancel
              </Button>
              <Button size="sm" onClick={handleAdd} disabled={!newUrl.trim()}>
                <Plus className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
            </div>
          </div>
        ) : (
          <Button
            variant="outline"
            size="sm"
            className="w-full mt-2"
            onClick={() => setIsAdding(true)}
          >
            <Plus className="w-3.5 h-3.5 mr-1" /> Add hyperlink
          </Button>
        )}
      </DialogContent>
    </Dialog>
  );
}
