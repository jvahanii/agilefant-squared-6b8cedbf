/**
 * What the picker does with the rows chosen: import them, mark the mail they
 * came from read, and — for a job search — put the list in order, mirror the
 * rows switched on, and check the ads already there for closed ones.
 *
 * Each flow reports by toast and returns whether it finished, so the picker
 * can close; none of them throws.
 */
import { useAppStore } from "@/store/appStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { currentListSortContext } from "@/store/listSortStore";
import { closedCheckMessage, linkedItemsIn, useClosedPostingsStore } from "@/store/closedPostingsStore";
import { toast } from "@/hooks/use-toast";
import { declinedSummary, distinctJobs, isCareerPageRow, rowKey, type PreviewLink } from "@/lib/gmailPreview";
import { explainGmailError } from "@/lib/gmailOAuth";
import { callGmail, type ImportMode, type RunnableSearch } from "@/lib/gmailConnector";
import { AUTO_PLACE_TOAST_MS, countOpenAds, hasClosingDate, importListOrder } from "@/lib/autoPlace";
import { sortTopLevel } from "@/lib/listSort";
import { topLevelItems } from "@/lib/workItemRows";
import { waitForItems } from "@/lib/waitForItems";

/** The search being imported from, and by whom. */
export interface ImportContext {
  search: RunnableSearch;
  mode: ImportMode;
  organizationId: string;
  /** The closed-ads check after an import is a superuser's tool. */
  canCheckClosed: boolean;
}

function importInto(ctx: ImportContext, backlogId: string, links: PreviewLink[]) {
  return callGmail<{
    created: number;
    skipped: number;
    collapsed: number;
    createdIds?: string[];
    /** The item made from each posting, by URL; absent from an older server. */
    createdByUrl?: Record<string, string>;
  }>({
    action: "import",
    mode: ctx.mode,
    organizationId: ctx.organizationId,
    treeId: ctx.search.tree_id,
    backlogId,
    queryId: ctx.search.id,
    links,
  });
}

/**
 * After an import, check the job ads that were already in the lists it filled
 * — the new ones were read moments ago. Same check as the backlog header's
 * "Check for closed ads", so a superuser's only: it spends a burst of server
 * requests. Closed ads are marked on their rows; nothing is changed. Runs on
 * after the picker has closed, and skips if a check is already going.
 */
async function checkExistingForClosed(
  ctx: ImportContext,
  backlogIds: string[],
  createdIds: string[],
  /**
   * The import into the chosen list only. Only one toast shows at a time, so
   * the check's report waits until `notBefore` rather than cutting the import
   * summary short, and then restates the open-ad totals with whatever the
   * check found closed.
   */
  after?: { notBefore: number; totals: () => string },
) {
  if (!ctx.canCheckClosed) return;
  const closedStore = useClosedPostingsStore.getState();
  if (closedStore.checking) return;
  const app = useAppStore.getState();
  const items = linkedItemsIn(app.workItems, app.hyperlinks, ctx.search.tree_id, new Set(backlogIds), new Set(createdIds));
  if (items.length === 0) return;
  const message = closedCheckMessage(await closedStore.check(items));
  const wait = after ? after.notBefore - Date.now() : 0;
  if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
  toast({
    ...message,
    title: `Existing ads: ${message.title.charAt(0).toLowerCase()}${message.title.slice(1)}`,
    ...(after ? { description: [message.description, after.totals()].filter(Boolean).join(" ") } : {}),
  });
}

/**
 * Mark the emails these rows came from as read, and return how many were.
 * Best-effort: a failure is reported, not thrown — and a connection made
 * before the app asked for permission to change labels cannot do this until
 * it is made again. -1 on a failure.
 */
async function markRead(ctx: ImportContext, links: PreviewLink[]): Promise<number> {
  // A career page's rows carry the page where an email's carry the email;
  // there is no message there to mark.
  const messageIds = [...new Set(links.filter((l) => !isCareerPageRow(l)).map((l) => l.messageId).filter(Boolean))];
  if (messageIds.length === 0) return 0;
  try {
    const marked = await callGmail<{ marked: number }>({ action: "mark_read", organizationId: ctx.organizationId, messageIds });
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
}

/**
 * What marking read is to an email, for the jobs among these rows that came
 * from a career page: remember them on the search, so the next run does not
 * offer them again. A page lists the same positions every day, and has no
 * "read" of its own to mark. Returns how many, or -1 on a failure it has
 * already reported.
 */
async function markSeen(ctx: ImportContext, links: PreviewLink[]): Promise<number> {
  const urls = [...new Set(links.filter(isCareerPageRow).map((l) => l.url))];
  if (urls.length === 0) return 0;
  try {
    const res = await callGmail<{ marked: number }>({
      action: "mark_pages_seen",
      organizationId: ctx.organizationId,
      queryId: ctx.search.id,
      urls,
    });
    return res.marked ?? 0;
  } catch (e) {
    toast({
      title: "Could not remember the career page jobs",
      description: `${(e as Error).message} They will be offered again next time.`,
      variant: "destructive",
    });
    return -1;
  }
}

/**
 * Nothing worth importing, but the alerts are still unread: mark every email
 * the search listed as read, so an "only unread" search stops offering them —
 * and skip every career page job listed, for the same reason. True when done.
 */
export async function declineAll(ctx: ImportContext, preview: PreviewLink[]): Promise<boolean> {
  const marked = await markRead(ctx, preview);
  if (marked < 0) return false;
  const skipped = await markSeen(ctx, preview);
  if (skipped < 0) return false;
  toast({ title: declinedSummary(marked, skipped), description: "Nothing was imported." });
  return true;
}

/** A link import: the picked rows into the search's own list. */
export async function importLinks(
  ctx: ImportContext,
  links: PreviewLink[],
  { onDone }: { onDone: () => void },
): Promise<void> {
  try {
    const res = await importInto(ctx, ctx.search.backlog_id, links);
    toast({
      title: `Imported ${res.created} work item${res.created === 1 ? "" : "s"}`,
      description: res.skipped
        ? `${res.skipped} already imported`
        : res.collapsed
          ? `${res.collapsed} duplicate${res.collapsed === 1 ? "" : "s"} in this import merged`
          : undefined,
    });
    onDone();
    await useAppStore.getState().loadFromSupabase();
    void checkExistingForClosed(ctx, [ctx.search.backlog_id], res.createdIds ?? []);
  } catch (e) {
    toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
  }
}

/**
 * Import every chosen posting into the one list the search names, then leave
 * that list in its order — the jobs with a deadline first, soonest at the
 * top, then the jobs without one by name — and keep that order as its rank.
 */
export async function importJobs(
  ctx: ImportContext,
  {
    links,
    importList,
    preview,
    visiblePreview,
    mirrorKeys,
    mirrorTarget,
    backlogName,
    onDone,
  }: {
    /** The rows picked, with their ratings. */
    links: PreviewLink[];
    importList: string;
    /** Every row listed, and those a keyword filter leaves in view. */
    preview: PreviewLink[];
    visiblePreview: PreviewLink[];
    /** The rows, picked and switched on, whose items are mirrored too. */
    mirrorKeys: Set<string>;
    mirrorTarget: { backlogId: string; treeId: string } | null;
    backlogName: (id: string) => string;
    /** Called once the import has gone through, before the list is put in order. */
    onDone: () => void;
  },
): Promise<void> {
  const { search, organizationId } = ctx;
  const reloadData = () => useAppStore.getState().loadFromSupabase();
  try {
    // The import reads the closing dates the picker does not know yet, so the
    // new items arrive with them and the ordering below can use them.
    const res = await importInto(ctx, importList, links);
    const created = res.created ?? 0;
    const createdIds = res.createdIds ?? [];

    // Every alert listed is done with: marking them read takes them out of an
    // "only unread" search, so the next run offers what has arrived since.
    //
    // Every one listed, not only the ones something was taken from. An alert
    // whose jobs are all in the lists already has nothing ticked, so nothing
    // was ever taken from it — and marked by that rule it stayed unread and
    // came back in every search, with nothing new in it, for good. Importing is
    // the end of going through what was listed: what was not ticked was left
    // out on purpose, by the picker or by the reader. What a keyword filter is
    // hiding has not been gone through, and stays — unless something ticked in
    // it was imported all the same.
    //
    // Best-effort — the import itself has already succeeded, and a connection
    // made before the app asked for permission to change labels cannot do
    // this until it is made again.
    const markedRead = await markRead(ctx, [...links, ...visiblePreview]);
    // A career page jobs were chosen from is done with in the same way: what
    // was left on it was left on purpose, so none of its rows comes back. A
    // page nothing was taken from stays: it is no alert to be rid of, and
    // lists the same jobs tomorrow.
    const pagesChosenFrom = new Set(links.filter(isCareerPageRow).map((l) => l.messageId));
    const onThosePages = preview.filter((l) => pagesChosenFrom.has(l.messageId));
    const leftOnPages = distinctJobs(onThosePages) - distinctJobs(links.filter(isCareerPageRow));
    const pagesRemembered = (await markSeen(ctx, onThosePages)) >= 0;

    onDone();
    // The new items have to be in the store before the list is ranked, or the
    // ranking covers only what was there before and the new ones land at the
    // end. A reload does not guarantee that: with cached data on screen it
    // returns at once and fetches in the background. So wait until the
    // imported items are actually here.
    await reloadData();
    const arrived = await waitForItems(createdIds, reloadData);

    // Ranking covers what was already in the list as well as what has just
    // arrived.
    const app = useAppStore.getState();
    // The rows switched on, turned into the items the import made of them. By
    // URL, which is what the import reports each new item under: the switch
    // is about a posting, and only an item can be mirrored.
    const toMirror = mirrorTarget
      ? [
          ...new Set(
            preview
              .filter((l) => mirrorKeys.has(rowKey(l)))
              .map((l) => res.createdByUrl?.[l.url])
              .filter((id): id is string => !!id),
          ),
        ]
      : [];
    /**
     * Job ads still open in the list, read at the moment of asking: the toast
     * asks once the list is filled, the closed check again once it knows
     * more. Closed = closing date passed, or marked closed by a check.
     */
    const openTotals = () => {
      const { workItems } = useAppStore.getState();
      const { closed } = useClosedPostingsStore.getState();
      const items = topLevelItems(workItems, search.tree_id, new Set([importList]));
      const open = (dated: boolean) => countOpenAds(items.filter((item) => hasClosingDate(item) === dated), closed);
      return (
        `Open ads now: ${open(true) + open(false)} in total — ${open(true)} with a deadline, ` +
        `${open(false)} without (closed ones not counted).`
      );
    };
    let mirrored = 0;
    app.runBulk(() => {
      // The list's order: the jobs with a deadline first, soonest at the top,
      // then the jobs without one, by name.
      const deadlinesAsField = useOrgSettingsStore.getState().settings[organizationId]?.deadlinesEnabled ?? false;
      const byName = sortTopLevel(
        topLevelItems(useAppStore.getState().workItems, search.tree_id, new Set([importList])),
        "name-asc",
        search.tree_id,
        currentListSortContext(search.tree_id),
      );
      const ordered = importListOrder(byName, deadlinesAsField);
      if (ordered.length > 0) {
        app.applySiblingOrder(
          null,
          search.tree_id,
          [importList],
          ordered.map((item) => item.id),
          `Job import: ${ordered.length} items, deadlines first then by name`,
        );
      }

      // The rows switched on are mirrored into the chosen list as well — one
      // item, filed in both trees. Whatever rating a row was given plays no
      // part. Same bulk as the ranking: one undo takes back both.
      if (mirrorTarget && toMirror.length > 0) {
        app.moveWorkItemsToBacklog(toMirror, mirrorTarget.backlogId, mirrorTarget.treeId, "mirror", search.tree_id);
        mirrored = toMirror.length;
      }
    });

    toast({
      title: `Imported ${created} work item${created === 1 ? "" : "s"} into ${backlogName(importList)}`,
      description:
        (arrived
          ? `The list is in order — jobs with a deadline first, soonest at the top, then the rest by name — and that order is saved as its rank.`
          : `The new items took too long to load, so the list may not be fully in order.`) +
        (mirrored > 0 && mirrorTarget ? ` ${mirrored} also mirrored to ${backlogName(mirrorTarget.backlogId)}.` : "") +
        (markedRead > 0 ? ` ${markedRead} email${markedRead === 1 ? "" : "s"} marked as read.` : "") +
        (pagesRemembered && leftOnPages > 0
          ? ` ${leftOnPages} career page job${leftOnPages === 1 ? "" : "s"} left out will not be offered again.`
          : "") +
        ` ${openTotals()}`,
      duration: AUTO_PLACE_TOAST_MS,
    });
    void checkExistingForClosed(ctx, [importList], createdIds, {
      notBefore: Date.now() + AUTO_PLACE_TOAST_MS,
      totals: openTotals,
    });
  } catch (e) {
    toast({ title: "Import failed", description: (e as Error).message, variant: "destructive" });
  }
}
