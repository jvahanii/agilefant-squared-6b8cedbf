import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

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
  /** Work item ids whose posting said it is closed, from the last run. */
  closed: Set<string>;
  /** Work item ids the last run actually reached, so "none closed" is
   *  distinguishable from "never checked". */
  checked: Set<string>;
  checking: boolean;
  /** How far through the current run, for the button's own label. */
  progress: { done: number; total: number } | null;
  /**
   * Check every item given. Results land as each batch returns, so a long run
   * marks rows while it is still going rather than all at the end.
   */
  check: (items: { id: string; urls: string[] }[]) => Promise<{ closed: number; checked: number; error?: string }>;
  clear: () => void;
}

/**
 * URLs per request. The endpoint refuses more, and a request that carried a
 * whole backlog could sit long enough on slow postings to time out wholesale.
 */
export const POSTING_BATCH = 40;

export const useClosedPostingsStore = create<ClosedPostingsState>((set, get) => ({
  closed: new Set(),
  checked: new Set(),
  checking: false,
  progress: null,

  check: async (items) => {
    if (get().checking) return { closed: 0, checked: 0 };

    // One request per URL, but an item may hold several: the item is closed if
    // any of its postings says so, so the mapping back has to be many-to-one.
    const itemsByUrl = new Map<string, string[]>();
    for (const item of items) {
      for (const url of item.urls) {
        const ids = itemsByUrl.get(url);
        if (ids) ids.push(item.id);
        else itemsByUrl.set(url, [item.id]);
      }
    }
    const urls = [...itemsByUrl.keys()];
    if (urls.length === 0) return { closed: 0, checked: 0 };

    set({ checking: true, progress: { done: 0, total: urls.length }, closed: new Set(), checked: new Set() });

    let error: string | undefined;
    try {
      for (let at = 0; at < urls.length; at += POSTING_BATCH) {
        const batch = urls.slice(at, at + POSTING_BATCH);
        const { data, error: callError } = await supabase.functions.invoke('posting-status', {
          body: { urls: batch },
        });
        if (callError) throw callError;
        if (data?.error) throw new Error(data.error);

        const results: { url: string; closed: boolean }[] = data?.results ?? [];
        set((s) => {
          const closed = new Set(s.closed);
          const checked = new Set(s.checked);
          for (const result of results) {
            for (const id of itemsByUrl.get(result.url) ?? []) {
              checked.add(id);
              if (result.closed) closed.add(id);
            }
          }
          return { closed, checked, progress: { done: Math.min(at + batch.length, urls.length), total: urls.length } };
        });
      }
    } catch (e) {
      // Whatever came back before the failure is kept: a partial answer is
      // still worth showing, and the caller reports that it stopped early.
      error = e instanceof Error ? e.message : String(e);
    }

    set({ checking: false, progress: null });
    const { closed, checked } = get();
    return { closed: closed.size, checked: checked.size, error };
  },

  clear: () => set({ closed: new Set(), checked: new Set(), progress: null }),
}));
