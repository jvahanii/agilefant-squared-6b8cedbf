import { useEffect, useMemo, useRef, useState } from "react";
import { Globe, Loader2, MailCheck } from "lucide-react";
import { useAppStore } from "@/store/appStore";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import {
  alreadyInSummary,
  careerPageLine,
  declineLabel,
  emailCountOf,
  isCareerPageRow,
  pageCountOf,
  groupBySourceEmail,
  distinctJobs,
  keptCopies,
  previewSummary,
  repeatedElsewhere,
  repeatedRows,
  rowKey,
  sameJobRows,
  startingReason,
  type CareerPageNote,
  type PreviewLink,
} from "@/lib/gmailPreview";
import type { ImportMode, RunnableSearch } from "@/lib/gmailConnector";
import { listsShownInPicker, postingUrlsIn } from "@/lib/autoPlace";
import { useScramble } from "@/contexts/ScrambleContext";
import { useOrgStore } from "@/store/orgStore";
import { useImportPlacement } from "@/components/jobSearch/useImportPlacement";
import { useSearchRun } from "@/components/jobSearch/useSearchRun";
import {
  declineAll,
  importJobs,
  importLinks,
  startClosedCheck,
  type ClosedCheckWhileSearching,
  type ImportContext,
} from "@/components/jobSearch/jobImport";
import { GroupHeading, PostingRow, type RowExtras } from "@/components/jobSearch/PostingRows";

/**
 * Run a saved Gmail search and choose what to import from it.
 *
 * A job search also reads the company career pages it names, and offers the
 * positions on them that are new to it beside what the mail brought — each
 * page under a heading of its own, as each email is.
 *
 * Starts the search as soon as it is shown. Used inline under a saved search in
 * Bells & Whistles, and in a dialog from the app header — one component, so the
 * two can never drift apart in what they offer or how they import.
 *
 * The parts: the run itself (useSearchRun), where the postings go
 * (useImportPlacement), what importing does (jobImport) and how a row is drawn
 * (PostingRows). This is what the reader sees and chooses.
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
  const backlogs = useAppStore((s) => s.backlogs);
  const { importList, placementKnown, treeBacklogs, mirrorTarget, mirrorBacklogs, choosePlaceInto, backlogName } =
    useImportPlacement(search, mode);
  // Which postings are already in the list mirrored to — the shortlist of
  // jobs to apply for next — or in the list of jobs applied for. The search
  // says where in its own tree a posting already is; these are in another
  // tree, and whether a job found again is already on one of them is the
  // thing to know before reading it again. The lists are known by their ids;
  // a name is only ever read off one for showing.
  const itemsNow = useAppStore((s) => s.workItems);
  const linksNow = useAppStore((s) => s.hyperlinks);
  const setWorkItemRating = useAppStore((s) => s.setWorkItemRating);
  /**
   * The item a posting already in this search's tree is filed as, by the
   * posting's address. An unticked "already in …" row acts on that item —
   * rating and mirroring it — rather than importing a second one.
   */
  const existingItemByUrl = useMemo(() => {
    const byUrl = new Map<string, string>();
    if (mode !== "jobs") return byUrl;
    for (const item of Object.values(itemsNow)) {
      if (!item.backlogAssignments?.[search.tree_id]) continue;
      for (const link of linksNow?.[item.id] ?? []) if (!byUrl.has(link.url)) byUrl.set(link.url, item.id);
    }
    return byUrl;
  }, [mode, itemsNow, linksNow, search.tree_id]);
  const alsoInByUrl = useMemo(() => {
    const byUrl = new Map<string, string>();
    if (mode !== "jobs") return byUrl;
    for (const list of listsShownInPicker(backlogs, search.tree_id, mirrorTarget)) {
      const name = backlogs[list.backlogId]?.name;
      if (!name) continue;
      for (const url of postingUrlsIn(itemsNow, linksNow, list)) if (!byUrl.has(url)) byUrl.set(url, name);
    }
    return byUrl;
  }, [mode, backlogs, search.tree_id, mirrorTarget, itemsNow, linksNow]);

  const { isSuperuser } = useScramble();
  const roleOverride = useOrgStore((s) => s.roleOverride);
  // The posting reader is a superuser tool for now, like the header button —
  // and so is the closed-ads check that follows an import.
  const canReadInBrowser = isSuperuser && !roleOverride;

  const { loading, nothingFound, stage, progress, preview, pages, selected, untickedByHand, reading, chooseRows } = useSearchRun({
    search,
    mode,
    organizationId,
    canReadInBrowser,
    alsoInByUrl,
    onClose,
  });

  /** Star rating chosen per row, by row key; rows without an entry import unrated. */
  const [ratingByKey, setRatingByKey] = useState<Record<string, number | undefined>>({});
  /** Rows switched on for mirroring, by row key; every row starts off. */
  const [mirrorByKey, setMirrorByKey] = useState<Record<string, boolean>>({});
  const [importing, setImporting] = useState(false);
  const [filterKeyword, setFilterKeyword] = useState("");
  // Only the ads ticked for import: to look over what will be imported before
  // importing it. Live, so one unticked meanwhile goes out of the list too.
  const [onlyTicked, setOnlyTicked] = useState(false);

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
  // One row per posting. A job carried by three alerts drew three rows, which
  // read as three jobs however carefully each repeat was labelled — and the
  // import collapses them to one item regardless.
  //
  // Folded against the *visible* rows, not the whole preview: were the kept copy
  // decided over everything, a keyword filter that showed only a later email
  // would hide that copy and fold the rest, and a matching job would vanish.
  const foldedPreview = useMemo(() => {
    const kept = keptCopies(visiblePreview);
    return visiblePreview.filter((l) => kept.get(l.url) === l);
  }, [visiblePreview]);
  /** For a kept row, the other emails that carried it. */
  const alsoIn = useMemo(() => repeatedElsewhere(visiblePreview), [visiblePreview]);
  // After folding, so that the row shown for a posting is the one whose tick counts.
  const shownPreview = useMemo(
    () => (onlyTicked ? foldedPreview.filter((l) => selected[rowKey(l)]) : foldedPreview),
    [foldedPreview, onlyTicked, selected],
  );
  const visibleGroups = useMemo(() => groupBySourceEmail(shownPreview), [shownPreview]);
  // Counted before folding: an email whose every posting folded away still
  // carried those postings, and is still one of the emails "mark read" covers.
  // Counting the cards instead would contradict that button.
  const visibleEmailCount = useMemo(() => emailCountOf(visiblePreview), [visiblePreview]);
  const visiblePageCount = useMemo(() => pageCountOf(visiblePreview), [visiblePreview]);
  const pageByMessageId = useMemo(() => new Map(pages.map((p) => [p.messageId, p])), [pages]);
  // Over the whole list, not the filtered one: a row is a repeat because of an
  // earlier email, whether or not the filter happens to show that email.
  // And with them the rows that are another row's job under a different link —
  // the same ad on two boards. A row that is both says it is a repeat.
  const repeats = useMemo(() => new Map([...sameJobRows(preview), ...repeatedRows(preview)]), [preview]);
  const emailCount = useMemo(() => emailCountOf(preview), [preview]);
  /** Jobs listed from career pages — what "skip" on the decline button covers. */
  const pageJobCount = useMemo(() => distinctJobs(preview.filter(isCareerPageRow)), [preview]);
  // Nothing ticked means there is no new job to import — mark-as-read then
  // becomes the only meaningful action and stands out for it.
  const noNewJobs = useMemo(() => preview.every((l) => !selected[rowKey(l)]), [preview, selected]);

  const importContext: ImportContext = { search, mode, organizationId, canCheckClosed: canReadInBrowser };

  // The ads already in the list imported into are checked for closed ones
  // while the search runs, not after the import: started as soon as the
  // list is known, and again for another list chosen here. The import takes
  // up the answer (importJobs).
  const closedCheck = useRef<ClosedCheckWhileSearching | null>(null);
  useEffect(() => {
    if (mode !== "jobs" || !placementKnown || !importList) return;
    const current = closedCheck.current;
    if (current?.treeId === search.tree_id && current.backlogId === importList) return;
    closedCheck.current = startClosedCheck(importContext, importList, current) ?? current;
    // importContext is rebuilt every render; what the check goes by is listed.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, placementKnown, importList, search.tree_id, canReadInBrowser]);

  /** The ticked rows, each with the rating given it. */
  const pickedLinks = () =>
    preview
      .filter((l) => selected[rowKey(l)])
      .map((l) => {
        const rating = ratingByKey[rowKey(l)];
        // Unrated is the server's default; leaving it out keeps the payload
        // exactly what an older build would send.
        return rating ? { ...l, rating } : l;
      });

  /** Run one of the flows below with the buttons held off meanwhile. */
  const busy = async (flow: () => Promise<void>) => {
    setImporting(true);
    try {
      await flow();
    } finally {
      setImporting(false);
    }
  };
  const nothingPicked = (links: PreviewLink[]) => {
    if (links.length > 0) return false;
    toast({ title: "Nothing selected", variant: "destructive" });
    return true;
  };

  const markAllRead = () =>
    busy(async () => {
      if (await declineAll(importContext, preview)) onClose();
    });

  const importSelected = async () => {
    const links = pickedLinks();
    if (nothingPicked(links)) return;
    await busy(() => importLinks(importContext, links, { onDone: onClose }));
  };

  const importIntoList = async () => {
    const links = pickedLinks();
    if (nothingPicked(links) || !importList) return;
    await busy(() =>
      importJobs(importContext, {
        links,
        importList,
        preview,
        visiblePreview,
        mirrorKeys: new Set(preview.map(rowKey).filter((key) => selected[key] && mirrorByKey[key])),
        mirrorTarget,
        backlogName,
        closedCheck: closedCheck.current,
        onDone: onClose,
      }),
    );
  };

  /** A row's stars and mirror switch, for the item it will make or the one already in the tree. */
  const extrasFor = (l: PreviewLink): RowExtras => {
    const key = rowKey(l);
    const existingId = !selected[key] && l.alreadyImported ? existingItemByUrl.get(l.url) : undefined;
    const existing = existingId ? itemsNow[existingId] : undefined;
    const mirroredAlready =
      !!existing && !!mirrorTarget && existing.backlogAssignments?.[mirrorTarget.treeId] === mirrorTarget.backlogId;
    return {
      existing,
      rating: ratingByKey[key],
      onRate: (r) => (existing ? setWorkItemRating(existing.id, r) : setRatingByKey((prev) => ({ ...prev, [key]: r }))),
      mirror: mirrorTarget && {
        label: backlogName(mirrorTarget.backlogId),
        on: existing ? mirroredAlready : !!mirrorByKey[key],
        locked: mirroredAlready,
        onChange: (on) => {
          if (!existing) {
            setMirrorByKey((prev) => ({ ...prev, [key]: on }));
          } else if (on && !mirroredAlready) {
            useAppStore
              .getState()
              .moveWorkItemsToBacklog([existing.id], mirrorTarget.backlogId, mirrorTarget.treeId, "mirror", search.tree_id);
          }
        },
      },
      importing,
    };
  };

  if (loading) return <SearchProgress stage={stage} value={progress} />;
  if (nothingFound) {
    const unreadOnly = /(^|\s)is:unread(\s|$)/i.test(search.query);
    const noun = mode === "jobs" ? "job ads" : "links";
    const readPages = pages.filter((p) => !p.error);
    return (
      <div className="space-y-3 py-2" role="status">
        <p className="flex items-start gap-2 text-sm">
          <MailCheck className="mt-0.5 h-4 w-4 shrink-0 text-primary" aria-hidden="true" />
          <span>
            <span className="font-medium">{unreadOnly ? "All caught up." : `No ${noun} found.`}</span>{" "}
            {unreadOnly
              ? `There are no unread emails with ${noun} matching this search. New alerts will show up here when they arrive.`
              : `None of the emails this search matches contain ${noun}. Check the search in Gmail itself, or widen how far back it looks.`}
            {readPages.length > 0 &&
              ` Nothing new on the career page${readPages.length === 1 ? "" : "s"} it reads either (${readPages
                .map((p) => p.name)
                .join(", ")}).`}
          </span>
        </p>
        <CareerPageNotes pages={pages} />
        <Button size="sm" variant="outline" onClick={onClose}>
          Close
        </Button>
      </div>
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
      {/* The list is already here; this is what is still being added to it. */}
      {progress !== null && <SearchProgress stage={stage} value={progress} />}
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
        <label className="flex shrink-0 cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <Switch checked={onlyTicked} onCheckedChange={setOnlyTicked} aria-label="Show only ticked ads" />
          Only ticked
        </label>
      </div>
      <p className="text-xs font-medium text-muted-foreground">
        {previewSummary({
          shown: distinctJobs(shownPreview),
          emails: visibleEmailCount,
          pages: visiblePageCount,
          // Over the rows actually listed, so the count and the list agree now
          // that the folded-away copies are not on screen to be counted.
          fresh: shownPreview.filter((l) => startingReason(l, repeats) === null).length,
          mode,
          total: filterKeyword || onlyTicked ? distinctJobs(preview) : undefined,
        })}
      </p>
      {/* Pages with no heading of their own below, because they brought no row:
          nothing new on them, or they could not be read. A page that was
          checked should not look like one that was forgotten. */}
      <CareerPageNotes pages={pages.filter((p) => !preview.some((l) => l.messageId === p.messageId))} />
      {reading && (
        <p className="flex items-center gap-2 text-xs text-muted-foreground" role="status">
          <Loader2 className="h-3.5 w-3.5 animate-spin" />
          Reading Jobly postings through your browser… {reading.done}/{reading.total}
        </p>
      )}
      {/* At most half the window, so on a short screen the dialog still fits
          with Import selected in reach — the dialog itself does not scroll. */}
      <div data-scroll-with-arrows className="max-h-[min(24rem,50vh)] overflow-y-auto space-y-4 pr-1">
        {onlyTicked && shownPreview.length === 0 && (
          <p className="py-6 text-center text-xs text-muted-foreground">
            No ads are ticked{filterKeyword ? " among those matching the filter" : ""}. Turn off Only ticked to see them all.
          </p>
        )}
        {visibleGroups.map((group) => {
          const keys = group.links.map(rowKey);
          return (
            <div key={group.messageId} className="border rounded-md overflow-hidden">
              <GroupHeading
                group={group}
                page={pageByMessageId.get(group.messageId)}
                allChecked={keys.every((k) => selected[k])}
                alreadyIn={alreadyInSummary(group.links)}
                onTickAll={(on) => chooseRows(keys, on)}
              />
              <div className="px-2 py-1.5 pl-4 space-y-1.5">
                {group.links.map((l) => {
                  const key = rowKey(l);
                  return (
                    <PostingRow
                      key={key}
                      link={l}
                      ticked={!!selected[key]}
                      reasonUnticked={startingReason(l, repeats) ?? (untickedByHand[key] ? "you unticked it" : null)}
                      folded={alsoIn.get(key)}
                      onTick={(on) => chooseRows([key], on)}
                      extras={extrasFor(l)}
                    />
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>
      {mode === "jobs" && (
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs text-muted-foreground">
          {/* The one list every chosen posting goes into. Saved on the search
              by id, so renaming the list changes what this shows and nothing
              else. */}
          <label className="flex min-w-0 items-center gap-1.5">
            <span className="font-medium text-foreground">Import into</span>
            <select
              value={importList ?? ""}
              onChange={(e) => e.target.value && e.target.value !== importList && void choosePlaceInto("list", e.target.value)}
              disabled={importing}
              aria-label="Import into"
              className="h-7 max-w-[16rem] truncate rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
            >
              {/* Shown only while the list in use is not one of this tree's:
                  deleted, or not loaded yet. */}
              {!treeBacklogs.some((b) => b.id === importList) && <option value={importList ?? ""}>Choose a list…</option>}
              {treeBacklogs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          {/* Where the rows switched to mirror go as well. Shows the default
              until the search chooses another; only lists in other trees,
              since an item holds one list per tree. */}
          <label className="flex min-w-0 items-center gap-1.5">
            Mirror to
            <select
              value={mirrorTarget?.backlogId ?? ""}
              onChange={(e) => void choosePlaceInto("mirror", e.target.value || null)}
              disabled={importing}
              aria-label="Mirror to"
              className="h-7 max-w-[16rem] truncate rounded-md border border-input bg-background px-1.5 text-xs text-foreground"
            >
              {!mirrorTarget && <option value="">Choose a list…</option>}
              {mirrorBacklogs.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      )}
      <div className="flex flex-wrap items-center gap-2">
        {/* A job search has one import, into its one list. The plain import
            below is the link import's: it used to be offered for jobs as well,
            into the list the search was saved with, which was a second place
            for a job to end up. */}
        {mode === "jobs" && importList ? (
          <Button
            size="sm"
            variant="destructive"
            onClick={importIntoList}
            disabled={importing || progress !== null}
            title={
              `Every ticked posting goes into ${backlogName(importList)}. The list is then put in order — jobs with a deadline first, soonest at the top, then the rest by name — and that order saved as its rank. The emails are marked as read.` +
              (mirrorTarget ? ` Rows switched to mirror also appear in ${backlogName(mirrorTarget.backlogId)}.` : "")
            }
          >
            {importing && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            Import selected into {backlogName(importList)}
          </Button>
        ) : (
          <Button size="sm" variant="secondary" onClick={importSelected} disabled={importing || progress !== null}>
            {importing && <Loader2 className="w-3.5 h-3.5 mr-1 animate-spin" />}
            Import selected
          </Button>
        )}
        {mode === "jobs" && (
          <Button
            size="sm"
            variant={noNewJobs ? "destructive" : "secondary"}
            onClick={markAllRead}
            disabled={importing || progress !== null}
            title={
              `Import nothing, and mark the ${emailCount} email${emailCount === 1 ? "" : "s"} listed here as read — for when none of the jobs are worth importing.` +
              (pageJobCount > 0
                ? ` The ${pageJobCount} job${pageJobCount === 1 ? "" : "s"} listed from career pages will not be offered again.`
                : "")
            }
          >
            <MailCheck className="w-3.5 h-3.5 mr-1" />
            {declineLabel(emailCount, pageJobCount)}
          </Button>
        )}
        <Button size="sm" variant="ghost" onClick={onClose} disabled={importing}>
          Cancel
        </Button>
      </div>
    </div>
  );
}

/** What the search is doing and how far it has got — while it waits for the
 *  first rows, and above the list while the rest is filled in. */
function SearchProgress({ stage, value }: { stage: string; value: number | null }) {
  return (
    <div className="space-y-1.5 py-1" role="status">
      <p className="flex items-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" /> {stage}
      </p>
      <Progress value={value ?? 0} className="h-1.5" aria-label="How far the search has got" />
    </div>
  );
}

/**
 * A line for each career page that has no heading in the list: one that could
 * not be read says why, and one with nothing new says so and what it holds.
 */
function CareerPageNotes({ pages }: { pages: CareerPageNote[] }) {
  if (pages.length === 0) return null;
  return (
    <ul className="space-y-0.5 text-xs text-muted-foreground">
      {pages.map((page) => (
        <li key={page.messageId} className="flex items-start gap-1.5">
          <Globe className="mt-0.5 h-3 w-3 shrink-0" aria-hidden="true" />
          <span className={page.error ? "text-destructive" : undefined}>
            <a href={page.url} target="_blank" rel="noreferrer" className="underline">
              {page.name}
              {page.error ? "" : "'s career page"}
            </a>
            {page.error ? `: ${page.error}` : `: nothing new · ${careerPageLine(page)}`}
          </span>
        </li>
      ))}
    </ul>
  );
}
