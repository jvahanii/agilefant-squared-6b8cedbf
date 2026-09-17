import { useEffect, useMemo, useRef, useState } from "react";
import { LinkIcon, Loader2, Mail } from "lucide-react";
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
  uncheckedReason,
  type PreviewLink,
} from "@/lib/gmailPreview";
import { explainGmailError } from "@/lib/gmailOAuth";
import { callGmail, type ImportMode, type RunnableSearch } from "@/lib/gmailConnector";
import { postingReaderAvailable, readableInBrowser, readPostingFacts } from "@/lib/postingReader";
import { AUTO_PLACE_BACKLOGS, findAutoPlaceTargets, splitByDeadline } from "@/lib/autoPlace";
import { sortTopLevel } from "@/lib/listSort";
import { topLevelItems } from "@/lib/workItemRows";
import { currentListSortContext } from "@/store/listSortStore";
import { useScramble } from "@/contexts/ScrambleContext";
import { useOrgStore } from "@/store/orgStore";

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
  const backlogs = useAppStore((s) => s.backlogs);
  // Only where this tree has both lists to place into; elsewhere the button
  // simply is not offered.
  const autoPlace = useMemo(
    () => (mode === "jobs" ? findAutoPlaceTargets(backlogs, search.tree_id) : null),
    [backlogs, mode, search.tree_id],
  );
  const [loading, setLoading] = useState(true);
  const [preview, setPreview] = useState<PreviewLink[]>([]);
  const [selected, setSelected] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState("");
  const [reading, setReading] = useState<{ done: number; total: number } | null>(null);
  /** Rows ticked or unticked by hand, which a late answer must not overrule. */
  const touched = useRef(new Set<string>());
  const { isSuperuser } = useScramble();
  const roleOverride = useOrgStore((s) => s.roleOverride);
  // The posting reader is a superuser tool for now, like the header button.
  const canReadInBrowser = isSuperuser && !roleOverride;

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
        // Anything uncheckedReason names starts unchecked — already in the tree,
        // no longer accepting applications, or past its closing date. They stay
        // importable on purpose, and the row says which it is.
        setSelected(
          Object.fromEntries(sorted.map((l) => [`${l.messageId}|${l.url}`, uncheckedReason(l) === null])),
        );
        setLoading(false);

        // Postings the server was refused (Jobly) are read through the browser,
        // when the posting reader extension is there. The list is already
        // usable meanwhile; rows gain their deadline as each answer arrives.
        if (!canReadInBrowser) return;
        const urls = [
          ...new Set(sorted.filter((l) => !l.deadline && !l.applicationsClosed && readableInBrowser(l.url)).map((l) => l.url)),
        ];
        if (urls.length === 0 || !(await postingReaderAvailable())) return;
        if (cancelled) return;
        setReading({ done: 0, total: urls.length });
        for (const [i, url] of urls.entries()) {
          const reference = sorted.find((l) => l.url === url)?.date || new Date().toISOString();
          const facts = await readPostingFacts(url, reference);
          if (cancelled) return;
          if (facts.deadline || facts.closed) {
            setPreview((prev) =>
              prev.map((l) =>
                l.url === url
                  ? { ...l, deadline: l.deadline ?? facts.deadline, applicationsClosed: l.applicationsClosed || !!facts.closed }
                  : l,
              ),
            );
            // What was just learnt can make the row one to leave alone: closed,
            // or a closing date already past. Never overrules a row the reader
            // has ticked or unticked by hand.
            if (uncheckedReason({ ...facts, deadline: facts.deadline, applicationsClosed: facts.closed })) {
              setSelected((prev) => {
                const next = { ...prev };
                for (const l of sorted) {
                  const key = `${l.messageId}|${l.url}`;
                  if (l.url === url && !touched.current.has(key)) next[key] = false;
                }
                return next;
              });
            }
          }
          setReading({ done: i + 1, total: urls.length });
        }
        setReading(null);
      } catch (e) {
        if (cancelled) return;
        const message = (e as Error).message;
        toast({
          title: message.includes("gmail_not_connected") ? "Connect Gmail again" : "Gmail search failed",
          // An expired connection lands here too, so say where the fix is.
          description: message.includes("gmail_not_connected")
            ? "Gmail is not connected, or the connection has expired. Reconnect it under Bells & Whistles → Your Gmail account."
            : explainGmailError(message),
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

  const pickedLinks = () => preview.filter((l) => selected[`${l.messageId}|${l.url}`]);

  const importInto = (backlogId: string, links: PreviewLink[]) =>
    callGmail<{ created: number; skipped: number; collapsed: number }>({
      action: "import",
      mode,
      organizationId,
      treeId: search.tree_id,
      backlogId,
      queryId: search.id,
      links,
    });

  const importSelected = async () => {
    const links = pickedLinks();
    if (links.length === 0) {
      toast({ title: "Nothing selected", variant: "destructive" });
      return;
    }
    setImporting(true);
    try {
      const res = await importInto(search.backlog_id, links);
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

  /**
   * Import each posting into the list its closing date decides, then put both
   * lists in name order and keep that order as their rank. An imported title
   * starts with its closing date, so name order is closing-date order.
   */
  const importAndAutoPlace = async () => {
    const links = pickedLinks();
    if (links.length === 0) {
      toast({ title: "Nothing selected", variant: "destructive" });
      return;
    }
    if (!autoPlace) return;
    setImporting(true);
    try {
      const { dated, undated } = splitByDeadline(links);
      const results = await Promise.all([
        dated.length ? importInto(autoPlace.withDeadline, dated) : Promise.resolve(null),
        undated.length ? importInto(autoPlace.withoutDeadline, undated) : Promise.resolve(null),
      ]);
      const created = results.reduce((sum, r) => sum + (r?.created ?? 0), 0);
      onClose();
      await reloadData();

      // Ranking runs on the data as it is after the reload, so it covers what
      // was already in each list as well as what has just arrived.
      const app = useAppStore.getState();
      app.runBulk(() => {
        for (const backlogId of [autoPlace.withDeadline, autoPlace.withoutDeadline]) {
          const ordered = sortTopLevel(
            topLevelItems(useAppStore.getState().workItems, search.tree_id, new Set([backlogId])),
            "name-asc",
            search.tree_id,
            currentListSortContext(search.tree_id),
          );
          if (ordered.length === 0) continue;
          app.applySiblingOrder(
            null,
            search.tree_id,
            [backlogId],
            ordered.map((item) => item.id),
            `Auto-placed import: ${ordered.length} items in name order`,
          );
        }
      });

      toast({
        title: `Imported ${created} work item${created === 1 ? "" : "s"}`,
        description: `${dated.length} with a deadline into ${AUTO_PLACE_BACKLOGS.withDeadline}, ${undated.length} without into ${AUTO_PLACE_BACKLOGS.withoutDeadline}. Both lists sorted by name and saved as rank.`,
      });
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
      {reading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading Jobly postings through your browser… {reading.done}/{reading.total}
        </p>
      )}
      {/* At most half the window, so on a short screen the dialog still fits
          with Import selected in reach — the dialog itself does not scroll. */}
      <div className="max-h-[min(24rem,50vh)] overflow-y-auto space-y-4 pr-1">
        {visibleGroups.map((group) => {
          const keys = group.links.map((l) => `${l.messageId}|${l.url}`);
          const allChecked = keys.every((k) => selected[k]);
          const seen = group.links.filter((l) => l.alreadyImported).length;
          return (
            <div key={group.messageId} className="border rounded-md overflow-hidden">
              {/* The source email, above the jobs it produced. It reads as a
                  heading rather than a first row: solid bar, an envelope, and
                  the subject in its own weight — the postings beneath sit in
                  from its edge. The subject wraps rather than truncates, since a
                  digest subject is long and what identifies it sits at the end. */}
              <div className="flex items-start gap-2 border-b bg-muted px-2 py-2">
                <Checkbox
                  checked={allChecked}
                  onCheckedChange={(c) => {
                    keys.forEach((k) => touched.current.add(k));
                    setSelected((prev) => {
                      const next = { ...prev };
                      for (const k of keys) next[k] = !!c;
                      return next;
                    });
                  }}
                  className="mt-0.5"
                  aria-label={`Select all ${group.links.length} from ${group.subject}`}
                />
                <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
                <div className="min-w-0 flex-1 space-y-0.5">
                  <p className="text-sm font-semibold leading-snug break-words">{group.subject}</p>
                  <p className="text-xs text-muted-foreground break-words">
                    {senderName(group.from)}
                    {senderAddress(group.from) && (
                      <span className="break-all"> &lt;{senderAddress(group.from)}&gt;</span>
                    )}
                    {group.date && ` · ${new Date(group.date).toLocaleString()}`}
                  </p>
                  <p className="text-xs text-muted-foreground">
                    {group.links.length} job{group.links.length === 1 ? "" : "s"} in this email
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

              <div className="px-2 py-1.5 pl-4 space-y-1.5">
                {group.links.map((l) => {
                  const key = `${l.messageId}|${l.url}`;
                  return (
                    <label key={key} className="flex items-start gap-2 text-sm">
                      <Checkbox
                        checked={!!selected[key]}
                        onCheckedChange={(c) => {
                          touched.current.add(key);
                          setSelected((s) => ({ ...s, [key]: !!c }));
                        }}
                        className="mt-0.5"
                      />
                      <span className="min-w-0 flex-1">
                        {/* The title gives way, the labels do not: a long title
                            used to push the reason a row is unticked out of the
                            truncated line, leaving it looking unticked for no
                            reason. */}
                        <span className="flex items-baseline gap-2 font-medium text-sm">
                          <span className="truncate">{l.title}</span>
                          <span className="flex shrink-0 items-baseline gap-2">
                            <span
                              className={`align-middle text-[10px] font-normal uppercase tracking-wide border rounded px-1 py-0.5 ${
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
                              // Its own colour: which list a posting is already
                              // in is the thing worth spotting while scanning,
                              // and it read as one more grey label.
                              <span className="align-middle text-[10px] font-normal uppercase tracking-wide rounded px-1 py-0.5 border border-primary/40 bg-primary/10 text-primary">
                                {l.alreadyIn ? `already in ${l.alreadyIn}` : "already imported"}
                              </span>
                            )}
                          </span>
                        </span>
                        {!selected[key] && uncheckedReason(l) && (
                          <span className="block text-xs text-muted-foreground">
                            Not selected: {uncheckedReason(l)}. Tick it to import anyway.
                          </span>
                        )}
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
        {autoPlace && (
          <Button
            size="sm"
            variant="secondary"
            onClick={importAndAutoPlace}
            disabled={importing}
            title={`Postings with a closing date go to ${AUTO_PLACE_BACKLOGS.withDeadline}, the rest to ${AUTO_PLACE_BACKLOGS.withoutDeadline}. Both lists are then sorted by name and that order saved as rank.`}
          >
            Import &amp; auto-place
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose} disabled={importing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
