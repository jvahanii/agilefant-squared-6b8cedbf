import { useEffect, useMemo, useState } from "react";
import { LinkIcon, Loader2 } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  deadlineLabel,
  gmailMessageUrl,
  groupBySourceEmail,
  previewSummary,
  senderAddress,
  senderName,
  type PreviewLink,
} from "@/lib/gmailPreview";
import { explainGmailError } from "@/lib/gmailOAuth";
import { callGmail, type ImportMode, type RunnableSearch } from "@/lib/gmailConnector";

/**
 * Run a saved Gmail search and choose what to import from it.
 *
 * Starts the search as soon as it is shown. Used inline under a saved search in
 * Bells & Whistles, and in a dialog from the app header — one component, so the
 * two can never drift apart in what they offer or how they import.
 */
export function SavedSearchPicker({
  search,
  mode,
  organizationId,
  onClose,
}: {
  search: RunnableSearch;
  mode: ImportMode;
  organizationId: string;
  /** Called after an import, a cancel, or a search that found nothing or failed. */
  onClose: () => void;
}) {
  const reloadData = useAppStore((s) => s.loadFromSupabase);
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewLink[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState("");

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await callGmail<{ links: PreviewLink[] }>({
          action: "preview",
          organizationId,
          query: search.query,
          maxMessages: 25,
          mode,
          backlogId: search.backlog_id,
          // The whole tree, so a posting already filed into another list
          // counts as one that has been seen.
          treeId: search.tree_id,
        });
        if (cancelled) return;
        const sorted = [...res.links].sort(
          (a, b) => new Date(b.date || 0).getTime() - new Date(a.date || 0).getTime(),
        );
        if (sorted.length === 0) {
          toast({ title: "No links found for that query" });
          onClose();
          return;
        }
        setPreview(sorted);
        // Anything already in the target backlog starts unchecked, and so does a
        // posting that has stopped taking applications: both stay importable on
        // purpose, neither is the default.
        setSelected(
          Object.fromEntries(sorted.map((l) => [`${l.messageId}|${l.url}`, !l.alreadyImported && !l.applicationsClosed])),
        );
      } catch (e) {
        if (cancelled) return;
        const message = (e as Error).message;
        toast({
          title: message.includes("gmail_not_connected") ? "Connect Gmail first" : "Gmail search failed",
          description: message.includes("gmail_not_connected") ? undefined : explainGmailError(message),
          variant: "destructive",
        });
        onClose();
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // One search per mount: the caller remounts to run it again.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Derived once: the header count and the list must not disagree when a
  // keyword filter is on.
  const visiblePreview = useMemo(() => {
    if (!filterKeyword) return preview;
    const kw = filterKeyword.toLowerCase();
    return preview.filter(
      (l) =>
        l.subject?.toLowerCase().includes(kw) ||
        l.title?.toLowerCase().includes(kw) ||
        l.url?.toLowerCase().includes(kw) ||
        l.from?.toLowerCase().includes(kw),
    );
  }, [preview, filterKeyword]);
  const visibleGroups = useMemo(() => groupBySourceEmail(visiblePreview), [visiblePreview]);

  const importSelected = async () => {
    const links = preview.filter((l) => selected[`${l.messageId}|${l.url}`]);
    if (links.length === 0) {
      toast({ title: "Nothing selected", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const res = await callGmail<{ created: number; skipped: number; collapsed: number }>({
        action: "import",
        mode,
        organizationId,
        treeId: search.tree_id,
        backlogId: search.backlog_id,
        queryId: search.id,
        links,
      });
      toast({
        title: `Imported ${res.created} work item${res.created === 1 ? "" : "s"}`,
        description: res.skipped
          ? `${res.skipped} already imported`
          : res.collapsed
            ? `${res.collapsed} duplicate${res.collapsed === 1 ? "" : "s"} in this import merged`
            : undefined,
      });
      onClose();
      await reloadData();
    } catch (e) {
      toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
    } finally {
      setImporting(false);
    }
  };

  if (loading) {
    return (
      <p className="flex items-center gap-2 py-2 text-xs text-muted-foreground" role="status">
        <Loader2 className="h-3.5 w-3.5 animate-spin" /> Searching Gmail…
      </p>
    );
  }
  if (preview.length === 0) return null;

  return (
    // min-w-0: in a dialog this sits in a CSS grid, whose items refuse to shrink
    // below their content. Without it the picker grew to its longest title or
    // URL, overflowed the dialog, and left the list's scrollbar outside the
    // dialog box — where the dialog blocks scrolling, so it looked as if the
    // list would not scroll at all.
    <div className="min-w-0 space-y-2">
      <div className="flex items-center gap-2">
        <Input
          placeholder="Filter by keyword…"
          value={filterKeyword}
          onChange={(e) => setFilterKeyword(e.target.value)}
          className="h-7 text-xs flex-1"
        />
        {filterKeyword && (
          <Button size="sm" variant="ghost" className="text-xs h-7 px-2" onClick={() => setFilterKeyword("")}>
            Clear
          </Button>
        )}
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        {previewSummary({
          shown: visiblePreview.length,
          emails: visibleGroups.length,
          mode,
          total: filterKeyword ? preview.length : undefined,
        })}
      </p>
      {/* At most half the window, so on a short screen the dialog still fits
          with Import selected in reach — the dialog itself does not scroll. */}
      <div className="max-h-[min(24rem,50vh)] overflow-y-auto space-y-3 pr-1">
        {visibleGroups.map((group) => {
          const keys = group.links.map((l) => `${l.messageId}|${l.url}`);
          const allChecked = keys.every((k) => selected[k]);
          const seen = group.links.filter((l) => l.alreadyImported).length;
          return (
            <div key={group.messageId} className="border rounded-md">
              {/* The source email, above the jobs it produced. Wraps rather than
                  truncates: a digest subject is long and the part that
                  identifies it sits at the end, so clipping removes what the
                  credit is for. */}
              <div className="flex items-start gap-2 bg-muted/50 px-2 py-2 rounded-t-md">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(c) =>
                    setSelected((prev) => {
                      const next = { ...prev };
                      for (const k of keys) next[k] = !!c;
                      return next;
                    })
                  }
                  className="mt-0.5"
                  aria-label={`Select all ${group.links.length} from ${group.subject}`}
                />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-xs">
                    <span className="text-muted-foreground">From: </span>
                    <span className="font-medium break-words">{senderName(group.from)}</span>
                    {senderAddress(group.from) && (
                      <span className="text-muted-foreground break-all"> &lt;{senderAddress(group.from)}&gt;</span>
                    )}
                  </p>
                  <p className="text-xs">
                    <span className="text-muted-foreground">Subject: </span>
                    <span className="font-medium break-words">{group.subject}</span>
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {group.date && `${new Date(group.date).toLocaleString()} · `}
                    {group.links.length} job{group.links.length === 1 ? "" : "s"}
                    {seen > 0 && ` · ${seen} already in this backlog`}
                  </p>
                </div>
                <a
                  href={gmailMessageUrl(group.messageId)}
                  target="_blank"
                  rel="noreferrer"
                  className="text-xs underline shrink-0 text-muted-foreground hover:text-foreground"
                  title="Open this email in Gmail"
                >
                  Open in Gmail
                </a>
              </div>

              <div className="px-2 py-1.5 space-y-1.5">
                {group.links.map((l) => {
                  const key = `${l.messageId}|${l.url}`;
                  return (
                    <label key={key} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={!!selected[key]}
                        onCheckedChange={(c) => setSelected((s) => ({ ...s, [key]: !!c }))}
                        className="mt-0.5"
                      />
                      <span className="min-w-0">
                        <span className="block truncate font-medium text-sm">
                          {l.title}
                          <span
                            className={`ml-2 align-middle text-[10px] font-normal uppercase tracking-wide border rounded px-1 py-0.5 ${
                              l.applicationsClosed
                                ? "border-destructive/40 text-destructive"
                                : l.deadline
                                  ? ""
                                  : "text-muted-foreground"
                            }`}
                          >
                            {deadlineLabel(l)}
                          </span>
                          {l.alreadyImported && (
                            <span className="ml-2 align-middle text-[10px] font-normal uppercase tracking-wide text-muted-foreground border rounded px-1 py-0.5">
                              {l.alreadyIn ? `already in ${l.alreadyIn}` : "already imported"}
                            </span>
                          )}
                        </span>
                        <span className="block truncate text-xs text-muted-foreground">
                          <LinkIcon className="w-3 h-3 inline mr-1" />
                          {l.url}
                        </span>
                      </span>
                    </label>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      <div className="flex items-center gap-2">
        <Button size="sm" onClick={importSelected} disabled={importing}>
          {importing && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
          Import selected
        </Button>
        <Button size="sm" variant="ghost" onClick={onClose} disabled={importing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
