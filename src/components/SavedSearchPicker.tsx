import { useEffect, useMemo, useRef, useState } from "react";
import { LinkIcon, Loader2, Mail, MailCheck } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { toast } from "@/hooks/use-toast";
import {
  alreadyInSummary,
  deadlineLabel,
  gmailMessageUrl,
  groupBySourceEmail,
  distinctJobs,
  previewSummary,
  repeatedRows,
  rowKey,
  senderAddress,
  senderName,
  startingReason,
  uncheckedReason,
  type PreviewLink,
} from "@/lib/gmailPreview";
import { explainGmailError } from "@/lib/gmailOAuth";
import { callGmail, type ImportMode, type RunnableSearch } from "@/lib/gmailConnector";
import { postingReaderAvailable, readableInBrowser, readPostingFacts } from "@/lib/postingReader";
import { findAutoPlaceTargets, splitByDeadline } from "@/lib/autoPlace";
import { supabase } from "@/integrations/supabase/client";
import { sortTopLevel } from "@/lib/listSort";
import { topLevelItems } from "@/lib/workItemRows";
import { currentListSortContext } from "@/store/listSortStore";
import { waitForItems } from "@/lib/waitForItems";
import { useScramble } from "@/contexts/ScrambleContext";
import { useOrgStore } from "@/store/orgStore";
import { closedCheckMessage, linkedItemsIn, useClosedPostingsStore } from "@/store/closedPostingsStore";

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
  // Where "Import & auto-place" files postings, by backlog id, as saved on the
  // search. Read here rather than taken from the caller, whose copy of the
  // search may predate a change made in an earlier run of this picker.
  const [placeInto, setPlaceInto] = useState<{ dated: string | null; undated: string | null }>({
    dated: null,
    undated: null,
  });
  useEffect(() => {
    if (mode !== "jobs") return;
    let cancelled = false;
    void supabase
      .from("gmail_import_queries")
      .select("auto_place_dated_backlog_id, auto_place_undated_backlog_id")
      .eq("id", search.id)
      .maybeSingle()
      .then(({ data }) => {
        if (cancelled || !data) return;
        setPlaceInto({ dated: data.auto_place_dated_backlog_id, undated: data.auto_place_undated_backlog_id });
      });
    return () => {
      cancelled = true;
    };
  }, [mode, search.id]);
  const autoPlace = useMemo(
    () =>
      mode === "jobs"
        ? findAutoPlaceTargets(backlogs, {
            tree_id: search.tree_id,
            auto_place_dated_backlog_id: placeInto.dated,
            auto_place_undated_backlog_id: placeInto.undated,
          })
        : null,
    [backlogs, mode, search.tree_id, placeInto],
  );
  /** The lists a posting can be placed into: this search's tree, by name. */
  const treeBacklogs = useMemo(
    () =>
      Object.values(backlogs ?? {})
        .filter((b) => b.treeId === search.tree_id)
        .sort((a, b) => a.name.localeCompare(b.name)),
    [backlogs, search.tree_id],
  );
  const backlogName = (id: string) => backlogs?.[id]?.name ?? "?";

  /** Choosing a list saves it on the search straight away; a failure puts it back. */
  const choosePlaceInto = async (which: "dated" | "undated", id: string | null) => {
    const before = placeInto;
    setPlaceInto({ ...before, [which]: id });
    const column = which === "dated" ? "auto_place_dated_backlog_id" : "auto_place_undated_backlog_id";
    const { error } = await supabase
      .from("gmail_import_queries")
      .update({ [column]: id })
      .eq("id", search.id);
    if (error) {
      setPlaceInto(before);
      toast({ title: "Could not save the list", description: error.message, variant: "destructive" });
    }
  };
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
  // The posting reader is a superuser tool for now, like the header button —
  // and so is the closed-ads check that follows an import.
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
        // Anything startingReason names starts unchecked — already in the tree,
        // no longer accepting applications, past its closing date, or a repeat
        // of a posting another email already lists. They stay importable on
        // purpose, and the row says which it is.
        const repeats = repeatedRows(sorted);
        setSelected(Object.fromEntries(sorted.map((l) => [rowKey(l), startingReason(l, repeats) === null])));
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
  // Over the whole list, not the filtered one: a row is a repeat because of an
  // earlier email, whether or not the filter happens to show that email.
  const repeats = useMemo(() => repeatedRows(preview), [preview]);
  const emailCount = useMemo(() => new Set(preview.map((l) => l.messageId)).size, [preview]);

  const pickedLinks = () => preview.filter((l) => selected[`${l.messageId}|${l.url}`]);

  const importInto = (backlogId: string, links: PreviewLink[]) =>
    callGmail<{ created: number; skipped: number; collapsed: number; createdIds?: string[] }>({
      action: "import",
      mode,
      organizationId,
      treeId: search.tree_id,
      backlogId,
      queryId: search.id,
      links,
    });

  /**
   * After an import, check the job ads that were already in the lists it filled
   * — the new ones were read moments ago. Same check as the backlog header's
   * "Check for closed ads", so a superuser's only: it spends a burst of server
   * requests. Closed ads are marked on their rows; nothing is changed. Runs on
   * after the picker has closed, and skips if a check is already going.
   */
  const checkExistingForClosed = async (backlogIds: string[], createdIds: string[]) => {
    if (!canReadInBrowser) return;
    const closedStore = useClosedPostingsStore.getState();
    if (closedStore.checking) return;
    const app = useAppStore.getState();
    const items = linkedItemsIn(app.workItems, app.hyperlinks, search.tree_id, new Set(backlogIds), new Set(createdIds));
    if (items.length === 0) return;
    const message = closedCheckMessage(await closedStore.check(items));
    toast({ ...message, title: `Existing ads: ${message.title.charAt(0).toLowerCase()}${message.title.slice(1)}` });
  };

  /**
   * Mark the emails these rows came from as read, and return how many were.
   * Best-effort: a failure is reported, not thrown — and a connection made
   * before the app asked for permission to change labels cannot do this until
   * it is made again.
   */
  const markRead = async (links: PreviewLink[]): Promise<number> => {
    const messageIds = [...new Set(links.map((l) => l.messageId).filter(Boolean))];
    if (messageIds.length === 0) return 0;
    try {
      const marked = await callGmail<{ marked: number }>({ action: "mark_read", organizationId, messageIds });
      return marked.marked ?? 0;
    } catch (e) {
      const message = (e as Error).message;
      toast({
        title: "Could not mark the emails as read",
        description: message.includes("gmail_permission_missing")
          ? "Agilefant may now mark job alerts as read, which needs Gmail permission you have not given yet. Connect Gmail again under Bells & Whistles → Your Gmail account."
          : explainGmailError(message),
        variant: "destructive",
      });
      return -1;
    }
  };

  /**
   * Nothing worth importing, but the alerts are still unread: mark every email
   * the search listed as read, so an "only unread" search stops offering them.
   */
  const markAllRead = async () => {
    setImporting(true);
    try {
      const marked = await markRead(preview);
      if (marked < 0) return;
      toast({ title: `${marked} email${marked === 1 ? "" : "s"} marked as read`, description: "Nothing was imported." });
      onClose();
    } finally {
      setImporting(false);
    }
  };

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
      void checkExistingForClosed([search.backlog_id], res.createdIds ?? []);
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
      const createdIds = results.flatMap((r) => r?.createdIds ?? []);

      // The alerts these postings came from are done with: marking them read
      // takes them out of an "only unread" search, so the next run offers what
      // has arrived since. Best-effort — the import itself has already
      // succeeded, and a connection made before the app asked for permission to
      // change labels cannot do this until it is made again.
      const markedRead = await markRead(links);

      onClose();
      // The new items have to be in the store before the lists are ranked, or
      // the ranking covers only what was there before and the new ones land at
      // the end. A reload does not guarantee that: with cached data on screen
      // it returns at once and fetches in the background. So wait until the
      // imported items are actually here.
      await reloadData();
      const arrived = await waitForItems(createdIds, reloadData);

      // Ranking covers what was already in each list as well as what has just
      // arrived.
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
        description:
          `${dated.length} with a deadline into ${backlogName(autoPlace.withDeadline)}, ` +
          `${undated.length} without into ${backlogName(autoPlace.withoutDeadline)}. ` +
          (arrived
            ? `Both lists sorted by name and saved as rank.`
            : `The new items took too long to load, so the lists may not be fully sorted — sort them by name and save as rank.`) +
          (markedRead > 0 ? ` ${markedRead} email${markedRead === 1 ? "" : "s"} marked as read.` : ""),
      });
      void checkExistingForClosed([autoPlace.withDeadline, autoPlace.withoutDeadline], createdIds);
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
          shown: distinctJobs(visiblePreview),
          emails: visibleGroups.length,
          fresh: visiblePreview.filter((l) => startingReason(l, repeats) === null).length,
          mode,
          total: filterKeyword ? distinctJobs(preview) : undefined,
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
          const alreadyIn = alreadyInSummary(group.links);
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
                    {alreadyIn && ` · ${alreadyIn}`}
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
                        {!selected[key] && startingReason(l, repeats) && (
                          <span className="block text-xs text-muted-foreground">
                            Not selected: {startingReason(l, repeats)}. Tick it to import anyway.
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
      {mode === "jobs" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          <span className="font-medium text-foreground">Auto-place into:</span>
          {(
            [
              ["dated", "With a deadline"],
              ["undated", "Without"],
            ] as const
          ).map(([which, label]) => (
            <label key={which} className="flex min-w-0 items-center gap-1.5">
              {label}
              <select
                value={placeInto[which] ?? ""}
                onChange={(e) => void choosePlaceInto(which, e.target.value || null)}
                disabled={importing}
                className="h-7 max-w-[12rem] truncate rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
              >
                <option value="">Choose a list…</option>
                {treeBacklogs.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                  </option>
                ))}
              </select>
            </label>
          ))}
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" onClick={importSelected} disabled={importing}>
          {importing && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
          Import selected
        </Button>
        {mode === "jobs" && (
          <Button
            size="sm"
            variant="secondary"
            onClick={importAndAutoPlace}
            disabled={importing || !autoPlace}
            title={
              autoPlace
                ? `Postings with a closing date go to ${backlogName(autoPlace.withDeadline)}, the rest to ${backlogName(autoPlace.withoutDeadline)}. Both lists are then sorted by name and that order saved as rank.`
                : "Choose both lists above first."
            }
          >
            Import &amp; auto-place
          </Button>
        )}
        {mode === "jobs" && (
          <Button
            size="sm"
            variant="outline"
            onClick={markAllRead}
            disabled={importing}
            title="Import nothing, and mark every email listed here as read — for when none of its jobs are worth importing."
          >
            <MailCheck className="w-3.5 h-3.5 mr-1" />
            Mark {emailCount} email{emailCount === 1 ? "" : "s"} as read
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose} disabled={importing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}
