import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

/**
 * Which lists are scrambled, and by whom — the list's side of
 * scrambledItemsStore, and built the same way.
 *
 * A scrambled list's stored name *is* the scramble, so every view shows it
 * without asking this store anything. What the store adds is who may act on
 * it: only the person who scrambled a list can read its real name or put it
 * back, and nobody may rename it meanwhile.
 *
 * The original name is not here, and cannot be: no client role may select
 * `original_name`, and reveal_scrambled_backlog_name() hands it back only
 * against that person's PIN.
 */
interface ScrambledListsState {
  /** List id -> the profile that scrambled it, null if that profile is gone. */
  byList: Map<string, string | null>;
  /** List id -> the list it was scrambled with: a list under a scrambled one. */
  withList: Map<string, string>;
  /** Reload from the database. RLS returns every scrambled list the user can see. */
  load: () => Promise<void>;
  /** Reload soon, coalescing a burst of change events into one query. */
  scheduleLoad: () => void;
  /** Reflect a scramble or unscramble done in this tab without a round trip. */
  setScrambled: (backlogId: string, scrambledBy: string | null | undefined) => void;
}

/** How long to wait for a burst of change events to finish before reloading. */
export const LIST_SCRAMBLE_RELOAD_DEBOUNCE_MS = 250;

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export const useScrambledListsStore = create<ScrambledListsState>((set, get) => ({
  byList: new Map(),
  withList: new Map(),

  load: async () => {
    // Columns are listed rather than "*" because original_name is not granted
    // to any client role — asking for it would fail the whole query.
    const { data, error } = await supabase
      .from('backlog_scrambles')
      .select('backlog_id, scrambled_by, with_backlog_id');
    if (error) {
      console.error('Could not load scrambled lists:', error.message);
      return;
    }
    const rows = data ?? [];
    set({
      byList: new Map(rows.map((row) => [row.backlog_id, row.scrambled_by])),
      withList: new Map(
        rows.flatMap((row) => (row.with_backlog_id ? [[row.backlog_id, row.with_backlog_id] as [string, string]] : [])),
      ),
    });
  },

  scheduleLoad: () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void get().load();
    }, LIST_SCRAMBLE_RELOAD_DEBOUNCE_MS);
  },

  setScrambled: (backlogId, scrambledBy) =>
    set((s) => {
      const known = s.byList.has(backlogId);
      // Leave state untouched when nothing changes, so subscribers don't
      // re-render for a repeat of what they already show.
      if (scrambledBy === undefined ? !known : known && s.byList.get(backlogId) === scrambledBy) return {};
      const next = new Map(s.byList);
      if (scrambledBy === undefined) next.delete(backlogId);
      else next.set(backlogId, scrambledBy);
      if (scrambledBy !== undefined || !s.withList.has(backlogId)) return { byList: next };
      const withList = new Map(s.withList);
      withList.delete(backlogId);
      return { byList: next, withList };
    }),
}));
