import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Globe, Link2Off } from "lucide-react";
import { IconizedTitle } from "@/components/IconizedTitle";

/**
 * Create, copy and revoke the public read-only link for a tree (backlogId
 * null) or a backlog. Publishing and unpublishing go through RPCs because the
 * table has no write policies: the permission check — owners and admins of the
 * owning organization — lives in the database, not here.
 */
export function PublicLinkControls({ treeId, backlogId }: { treeId: string; backlogId: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let query = supabase.from("published_links").select("token").eq("tree_id", treeId);
    query = backlogId ? query.eq("backlog_id", backlogId) : query.is("backlog_id", null);
    const { data, error } = await query.maybeSingle();
    if (error) console.error("Could not load the public link:", error.message);
    setToken(data?.token ?? null);
    setLoaded(true);
  }, [treeId, backlogId]);

  useEffect(() => {
    void load();
  }, [load]);

  const url = token ? `${window.location.origin}/p/${token}` : "";
  const target = backlogId ? { _tree_id: treeId, _backlog_id: backlogId } : { _tree_id: treeId };

  const publish = async () => {
    setBusy(true);
    const { data, error } = await supabase.rpc("publish_backlog_link", target);
    setBusy(false);
    if (error) {
      toast({ title: "Could not publish", description: error.message, variant: "destructive" });
      return;
    }
    setToken(data);
  };

  const unpublish = async () => {
    setBusy(true);
    const { error } = await supabase.rpc("unpublish_backlog_link", target);
    setBusy(false);
    if (error) {
      toast({ title: "Could not unpublish", description: error.message, variant: "destructive" });
      return;
    }
    setToken(null);
    toast({ title: "Unpublished", description: "The link no longer works." });
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      toast({ title: "Link copied" });
    } catch {
      toast({ title: "Could not copy", description: "Select the link and copy it by hand.", variant: "destructive" });
    }
  };

  const what = backlogId ? "this backlog and everything under it" : "this whole tree";

  if (!loaded) return <p className="text-xs text-muted-foreground">Loading…</p>;

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Anyone with the link can view {what} without signing in: titles, descriptions, statuses and
        points. People, time, labels and links stay private.
      </p>
      {token ? (
        <>
          <div className="flex gap-2">
            <Input
              readOnly
              value={url}
              aria-label="Public link"
              className="h-8 text-xs font-mono"
              onFocus={(e) => e.currentTarget.select()}
            />
            <Button type="button" size="sm" variant="outline" className="h-8 shrink-0" onClick={copy}>
              <Copy className="w-3.5 h-3.5 mr-1" /> Copy
            </Button>
          </div>
          <div className="flex items-center justify-between gap-2">
            <a
              href={url}
              target="_blank"
              rel="noreferrer"
              className="inline-flex items-center gap-1 text-xs text-muted-foreground underline underline-offset-4 hover:text-foreground"
            >
              <ExternalLink className="w-3 h-3" /> Open
            </a>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              className="h-7 text-destructive hover:text-destructive"
              disabled={busy}
              onClick={unpublish}
            >
              <Link2Off className="w-3.5 h-3.5 mr-1" /> Stop publishing
            </Button>
          </div>
        </>
      ) : (
        <Button type="button" size="sm" className="h-8" disabled={busy} onClick={publish}>
          <Globe className="w-3.5 h-3.5 mr-1" /> Create public link
        </Button>
      )}
    </div>
  );
}

/** The backlog's own dialog, opened from its context menu. A tree's public
 *  link lives in ShareTreeDialog alongside organization sharing instead. */
export function PublishBacklogDialog({
  treeId,
  backlogId,
  backlogName,
  open,
  onOpenChange,
}: {
  treeId: string;
  backlogId: string;
  backlogName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">
            Public link: <IconizedTitle title={backlogName} />
          </DialogTitle>
        </DialogHeader>
        <PublicLinkControls treeId={treeId} backlogId={backlogId} />
      </DialogContent>
    </Dialog>
  );
}
