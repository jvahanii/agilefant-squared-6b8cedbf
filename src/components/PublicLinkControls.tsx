import { useCallback, useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "@/hooks/use-toast";
import { Copy, ExternalLink, Globe, Link2Off } from "lucide-react";
import { IconizedTitle } from "@/components/IconizedTitle";
import { usePublishedLinksStore } from "@/store/publishedLinksStore";
import { PUBLISHABLE_ATTRIBUTES, type PublishableAttribute } from "@/lib/publicBacklog";

interface LinkOptions {
  /** What this target's link hides. Empty — the default — shows everything. */
  hidden: PublishableAttribute[];
  /** What the tree has at all: points, labels and time only when the owning
   *  organization has them on. Nothing else is offered. */
  available: PublishableAttribute[];
}

/**
 * Create, copy and revoke the public read-only link for a tree (backlogId
 * null) or a backlog, and choose which item attributes it shows. Everything
 * goes through RPCs because the tables have no write policies: the permission
 * check — anyone who can see the tree — lives in the database, not here. So
 * does hiding: get_published_backlog() leaves a hidden attribute out of what
 * it sends.
 *
 * The choice belongs to the target rather than the link, so it can be made
 * before publishing and survives unpublishing.
 */
export function PublicLinkControls({ treeId, backlogId }: { treeId: string; backlogId: string | null }) {
  const [token, setToken] = useState<string | null>(null);
  const [options, setOptions] = useState<LinkOptions | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    let query = supabase.from("published_links").select("token").eq("tree_id", treeId);
    query = backlogId ? query.eq("backlog_id", backlogId) : query.is("backlog_id", null);
    const [link, opts] = await Promise.all([
      query.maybeSingle(),
      supabase.rpc("get_published_link_options", { _tree_id: treeId, _backlog_id: backlogId }),
    ]);
    if (link.error) {
      console.error("Could not load the public link:", link.error.message);
    } else {
      // Keep the sidebar markers honest with what the database says.
      usePublishedLinksStore.getState().setPublished(treeId, backlogId, !!link.data?.token);
    }
    if (opts.error) {
      console.error("Could not load what the public link shows:", opts.error.message);
    } else {
      setOptions(opts.data as unknown as LinkOptions);
    }
    setToken(link.data?.token ?? null);
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
    usePublishedLinksStore.getState().setPublished(treeId, backlogId, true);
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
    usePublishedLinksStore.getState().setPublished(treeId, backlogId, false);
    toast({ title: "Unpublished", description: "The link no longer works." });
  };

  const toggleAttribute = async (key: PublishableAttribute, shown: boolean) => {
    if (!options) return;
    const previous = options;
    const hidden = shown ? options.hidden.filter((h) => h !== key) : [...options.hidden, key];
    // Optimistic: the checkbox follows the click, and rolls back on failure.
    setOptions({ ...options, hidden });
    const { data, error } = await supabase.rpc("set_published_link_hidden_attributes", {
      _tree_id: treeId,
      _backlog_id: backlogId,
      _hidden: hidden,
    });
    if (error) {
      setOptions(previous);
      toast({ title: "Could not save", description: error.message, variant: "destructive" });
      return;
    }
    setOptions((o) => (o ? { ...o, hidden: (data ?? hidden) as PublishableAttribute[] } : o));
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

  const offered = options ? PUBLISHABLE_ATTRIBUTES.filter((a) => options.available.includes(a.key)) : [];

  return (
    <div className="space-y-2">
      <p className="text-xs text-muted-foreground">
        Anyone with the link can view {what} without signing in. Titles are always shown; choose what
        else is.
        {options?.available.includes("time") && " Individual time entries and their notes stay private."}
      </p>
      {offered.length > 0 && (
        <fieldset className="grid grid-cols-2 gap-x-4 gap-y-1.5 py-1">
          <legend className="sr-only">Shown on the public page</legend>
          {offered.map(({ key, label }) => {
            const id = `publish-attr-${key}`;
            return (
              <div key={key} className="flex items-center gap-2">
                <Checkbox
                  id={id}
                  checked={!options!.hidden.includes(key)}
                  onCheckedChange={(v) => void toggleAttribute(key, v === true)}
                />
                <Label htmlFor={id} className="text-xs font-normal">
                  {label}
                </Label>
              </div>
            );
          })}
        </fieldset>
      )}
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
