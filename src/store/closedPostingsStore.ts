import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { deadlinePassed, titleDeadline } from '../../supabase/functions/_shared/deadlines';
import type { Hyperlink, WorkItem } from '@/types/models';

/**
 * Which work items link to a job ad that has stopped taking applications.
 *
 * Deliberately not persisted, and never written back to the item. A closed ad
 * is a prompt to do something -- move it off the list, or decide it stays --
 * and the answer belongs to whoever is looking, not to a column. Reloading the
 * app clears this, which is correct: the answer is only as good as the moment
 * it was fetched.
 */
interface ClosedPostingsState {
  /** Work item ids whose posting said it is closed, from the latest run covering each. */
  closed: Set<string>;
  /** Work item ids a run actually reached, so "none closed" is
   *  distinguishable from "never checked". */
  checked: Set<string>;
  /**
   * Work item ids whose postings could not be read at all -- every link on them
   * refused us or timed out.
   *
   * Kept apart from the rest because the alternative is a lie. A job board that
   * answers a datacentre address with 999 would otherwise leave its postings
   * looking as open as one that actually said so.
   */
  unknown: Set<string>;
  checking: boolean;
  /** How far through the current run, for the button's own label. */
  progress: { done: number; total: number } | null;
  /**
   * Check every item given. Results land as each batch returns, so a long run
   * marks rows while it is still going rather than all at the end.
   */
  check: (
    items: { id: string; title: string; urls: string[] }[],
  ) => Promise<{ closed: number; checked: number; unknown: number; fromTitle: number; error?: string }>;
  /** Drop what is known about these items — the marks in one backlog, say. */
  forget: (ids: string[]) => void;
}

/**
 * URLs per request. The endpoint refuses more, and a request that carried a
 * whole backlog could sit long enough on slow postings to time out wholesale.
 *
 * Twenty rather than forty since the server started fetching three at a time
 * and retrying once: the worst case a batch can reach is what matters, and it
 * has to stay well inside the function's own deadline.
 */
export const POSTING_BATCH = 20;

export const useClosedPostingsStore = create<ClosedPostingsState>((set, get) => ({
  closed: new Set(),
  checked: new Set(),
  unknown: new Set(),
  checking: false,
  progress: null,

  check: async (items) => {
    if (get().checking) return { closed: 0, checked: 0, unknown: 0, fromTitle: 0 };

    // Settle whatever the item already knows about itself first. The import
    // writes the closing date into the title, so an item whose date has gone by
    // needs no request at all -- which is the only reliable way past a board
    // that will not answer one.
    const settled = new Set<string>();
    for (const item of items) {
      if (deadlinePassed(titleDeadline(item.title))) settled.add(item.id);
    }

    // One request per URL, but an item may hold several: the item is closed if
    // any of its postings says so, so the mapping back has to be many-to-one.
    const itemsByUrl = new Map<string, string[]>();
    for (const item of items) {
      if (settled.has(item.id)) continue;
      for (const url of item.urls) {
        const ids = itemsByUrl.get(url);
        if (ids) ids.push(item.id);
        else itemsByUrl.set(url, [item.id]);
      }
    }
    const urls = [...itemsByUrl.keys()];

    // A run replaces what is known about the items it covers, and only those:
    // marks on other lists' items, from an earlier run, stay where they are.
    const covered = new Set(items.map((item) => item.id));
    const keepOthers = (ids: Set<string>) => new Set([...ids].filter((id) => !covered.has(id)));
    const { closed: closedBefore, checked: checkedBefore, unknown: unknownBefore } = get();
    set({
      closed: new Set([...keepOthers(closedBefore), ...settled]),
      checked: new Set([...keepOthers(checkedBefore), ...settled]),
      unknown: keepOthers(unknownBefore),
    });
    if (urls.length === 0) {
      return { closed: settled.size, checked: settled.size, unknown: 0, fromTitle: settled.size };
    }

    set({ checking: true, progress: { done: 0, total: urls.length } });
    // An item counts as unreadable only when *none* of its links could be read:
    // one link that answered is enough to know something about the item.
    const reached = new Set<string>();

    let error: string | undefined;
    try {
      for (let at = 0; at < urls.length; at += POSTING_BATCH) {
        const batch = urls.slice(at, at + POSTING_BATCH);
        const { data, error: callError } = await supabase.functions.invoke('posting-status', {
          body: { urls: batch },
        });
        if (callError) throw callError;
        if (data?.error) throw new Error(data.error);

        const results: { url: string; closed: boolean; unreachable?: number | null }[] = data?.results ?? [];
        set((s) => {
          const closed = new Set(s.closed);
          const checked = new Set(s.checked);
          const unknown = new Set(s.unknown);
          for (const result of results) {
            for (const id of itemsByUrl.get(result.url) ?? []) {
              checked.add(id);
              if (result.closed) closed.add(id);
              if (result.unreachable === null || result.unreachable === undefined) reached.add(id);
              else unknown.add(id);
            }
          }
          // One readable link settles the item, so drop anything that has since
          // been reached through another of its links.
          for (const id of reached) unknown.delete(id);
          return {
            closed,
            checked,
            unknown,
            progress: { done: Math.min(at + batch.length, urls.length), total: urls.length },
          };
        });
      }
    } catch (e) {
      // Whatever came back before the failure is kept: a partial answer is
      // still worth showing, and the caller reports that it stopped early.
      error = e instanceof Error ? e.message : String(e);
    }

    set({ checking: false, progress: null });
    const { closed, checked, unknown } = get();
    const inRun = (ids: Set<string>) => [...ids].filter((id) => covered.has(id)).length;
    return {
      closed: inRun(closed),
      checked: inRun(checked),
      unknown: inRun(unknown),
      fromTitle: settled.size,
      error,
    };
  },

  forget: (ids) => {
    const drop = new Set(ids);
    const keep = (from: Set<string>) => new Set([...from].filter((id) => !drop.has(id)));
    set((s) => ({ closed: keep(s.closed), checked: keep(s.checked), unknown: keep(s.unknown) }));
  },
}));

/**
 * The items a closed-ads check reads: those in these backlogs of one tree that
 * carry at least one link. `exclude` leaves out items that need no check —
 * ones just imported, whose postings were read moments ago.
 */
export function linkedItemsIn(
  workItems: Record<string, WorkItem>,
  hyperlinks: Record<string, Hyperlink[]> | undefined,
  treeId: string,
  backlogIds: ReadonlySet<string>,
  exclude: ReadonlySet<string> = new Set(),
): { id: string; title: string; urls: string[] }[] {
  return Object.values(workItems)
    .filter((wi) => backlogIds.has(wi.backlogAssignments[treeId]) && !exclude.has(wi.id))
    .map((wi) => ({ id: wi.id, title: wi.title, urls: (hyperlinks?.[wi.id] ?? []).map((h) => h.url) }))
    .filter((item) => item.urls.length > 0);
}

/**
 * The message a finished check shows. The three outcomes are reported
 * separately on purpose: a board that turns the check away is not a board
 * saying its postings are live, and rolling the two together would quietly
 * overstate how healthy the list is.
 */
export function closedCheckMessage(
  result: Awaited<ReturnType<ClosedPostingsState["check"]>>,
): { title: string; description: string; variant?: "destructive" } {
  const { closed, checked, unknown, fromTitle, error } = result;
  if (error) {
    return {
      title: checked > 0 ? `Stopped after ${checked} item${checked !== 1 ? "s" : ""}` : "Could not check the ads",
      description: error,
      variant: "destructive",
    };
  }
  const open = checked - closed - unknown;
  const parts = [`${open} still open`];
  if (unknown > 0) parts.push(`${unknown} could not be reached`);
  if (fromTitle > 0) parts.push(`${fromTitle} from a closing date already on the item`);
  return {
    title: closed === 0 ? "No closed ads found" : `${closed} closed ad${closed !== 1 ? "s" : ""}`,
    description: `${parts.join(", ")}. Of ${checked} checked; nothing was changed.`,
    ...(unknown > checked / 2 ? { variant: "destructive" as const } : {}),
  };
}
