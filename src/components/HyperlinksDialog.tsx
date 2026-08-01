import { useState, useEffect, useRef, useMemo } from "react";
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
import { isAttachmentUrl, resolveOpenableHref } from "@/lib/attachmentUrl";
import { useIsMobile } from "@/hooks/use-mobile";
import { focusForEdit } from "@/lib/focusEdit";

const isValidUrl = (url: string) => /^https?:\/\//i.test(url);
const safeHref = (url: string) => (isValidUrl(url) ? url : "#");

const handleHyperlinkClick = async (e: React.MouseEvent<HTMLAnchorElement>, url: string) => {
  if (!isValidUrl(url) || !isAttachmentUrl(url)) return;
  e.preventDefault();
  const href = await resolveOpenableHref(url);
  window.open(href, "_blank", "noopener,noreferrer");
};

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
  const renameWorkItem = useAppStore((s) => s.renameWorkItem);
  const hyperlinksRaw = useAppStore((s) => s.hyperlinks[workItemId]);
  const hyperlinks = useMemo(() => hyperlinksRaw ?? [], [hyperlinksRaw]);
  const addHyperlink = useAppStore((s) => s.addHyperlink);
  const updateHyperlink = useAppStore((s) => s.updateHyperlink);
  const removeHyperlink = useAppStore((s) => s.removeHyperlink);

  const isMobile = useIsMobile();
  const [isAdding, setIsAdding] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newAltText, setNewAltText] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editUrl, setEditUrl] = useState("");
  const [editAltText, setEditAltText] = useState("");
  // Inline title editing
  const [isEditingTitle, setIsEditingTitle] = useState(false);
  const [editTitle, setEditTitle] = useState("");
  const titleInputRef = useRef<HTMLInputElement>(null);
  const urlInputRef = useRef<HTMLInputElement>(null);
  const editUrlRef = useRef<HTMLInputElement>(null);
  const firstLinkRef = useRef<HTMLAnchorElement>(null);
  // Keep a ref so the open-effect can read the current hyperlinks length
  // without adding hyperlinks to its dependency array.
  const hyperlinksRef = useRef(hyperlinks);
  hyperlinksRef.current = hyperlinks;

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

  useEffect(() => {
    if (isEditingTitle) {
      setTimeout(() => focusForEdit(titleInputRef.current, isMobile), 0);
    }
  }, [isEditingTitle, isMobile]);

  // Reset form when dialog closes; set initial mode when it opens.
  useEffect(() => {
    if (!open) {
      setIsAdding(false);
      setNewUrl("");
      setNewAltText("");
      setEditingId(null);
      setIsEditingTitle(false);
      return;
    }
    setIsEditingTitle(false);
    const hasLinks = hyperlinksRef.current.length > 0;
    setIsAdding(!hasLinks);
    if (hasLinks) {
      // Focus the first hyperlink so Enter opens it and Tab navigates the list.
      setTimeout(() => firstLinkRef.current?.focus(), 0);
    }
    // Intentionally only runs when `open` changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const commitTitle = () => {
    const trimmed = editTitle.trim();
    if (trimmed && trimmed !== item?.title) renameWorkItem(workItemId, trimmed);
    setIsEditingTitle(false);
  };

  const startTitleEdit = () => {
    setEditTitle(item?.title ?? "");
    setIsEditingTitle(true);
  };


  if (!item) return null;

  const handleAdd = () => {
    const trimmedUrl = newUrl.trim();
    if (!trimmedUrl) return;
    if (!isValidUrl(trimmedUrl)) return;
    addHyperlink(workItemId, trimmedUrl, newAltText.trim());
    setNewUrl("");
    setNewAltText("");
    setIsAdding(false);
    onOpenChange(false);
  };

  const handleStartEdit = (linkId: string, url: string, altText: string) => {
    setEditingId(linkId);
    setEditUrl(url);
    setEditAltText(altText);
  };

  const handleSaveEdit = () => {
    if (!editingId) return;
    const trimmedUrl = editUrl.trim();
    if (!trimmedUrl || !isValidUrl(trimmedUrl)) return;
    updateHyperlink(editingId, workItemId, trimmedUrl, editAltText.trim());
    setEditingId(null);
  };

  const handleCancelEdit = () => {
    setEditingId(null);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="sm:max-w-md"
        onClick={(e) => e.stopPropagation()}
        onOpenAutoFocus={(e) => e.preventDefault()}
      >
        <DialogHeader>
          <DialogTitle>Hyperlinks</DialogTitle>
        </DialogHeader>
        {isEditingTitle ? (
          <div className="flex items-center gap-2 mb-4">
            <Input
              ref={titleInputRef}
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              className="h-8 text-sm flex-1"
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  const trimmed = editTitle.trim();
                  if (trimmed && trimmed !== item.title) renameWorkItem(workItemId, trimmed);
                  setIsEditingTitle(false);
                }
                if (e.key === "Escape") setIsEditingTitle(false);
              }}
            />
            <Button variant="ghost" size="sm" onClick={() => setIsEditingTitle(false)}>
              <X className="w-3.5 h-3.5" />
            </Button>
          </div>
        ) : (
          <div
            className="text-sm text-muted-foreground mb-4 truncate cursor-text hover:text-foreground transition-colors"
            title={`${item.title} (double-click to edit)`}
            onDoubleClick={() => { setEditTitle(item.title); setIsEditingTitle(true); }}
          >
            {item.title}
          </div>
        )}

        {/* Existing hyperlinks */}
        <div className="space-y-2 max-h-64 overflow-y-auto">
          {hyperlinks.length === 0 && !isAdding && (
            <p className="text-sm text-muted-foreground text-center py-4">
              No hyperlinks yet. Add one below.
            </p>
          )}
          {hyperlinks.map((link, index) =>
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
                    ref={index === 0 ? firstLinkRef : undefined}
                    href={safeHref(link.url)}
                    target="_blank"
                    rel="noopener noreferrer"
                    onClick={(e) => handleHyperlinkClick(e, link.url)}
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
                <div className="flex items-center gap-0.5 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity shrink-0">
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
                  if (e.key === "Enter") {
                    if (newUrl.trim()) handleAdd();
                    else onOpenChange(false);
                  }
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
            {/* Add comes first in DOM (tab-first) but second visually via CSS order */}
            <div className="flex justify-end gap-1">
              <Button size="sm" onClick={handleAdd} disabled={!newUrl.trim()} className="order-2">
                <Plus className="w-3.5 h-3.5 mr-1" /> Add
              </Button>
              <Button variant="ghost" size="sm" onClick={() => setIsAdding(false)} className="order-1">
                Cancel
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
