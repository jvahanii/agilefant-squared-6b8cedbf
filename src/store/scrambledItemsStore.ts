import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

/**
 * Which work items are scrambled, and by whom.
 *
 * A scrambled item's stored title *is* the scramble, so every view shows it
 * without asking this store anything. What the store adds is who may act on
 * it: only the person who scrambled an item can read its real name or put it
 * back, and nobody may rename it meanwhile.
 *
 * The original title is not here, and cannot be: no client role may select
 * `original_title`, and reveal_scrambled_title() hands it back only against
 * that person's PIN.
 */
interface ScrambledItemsState {
  /** Work item id -> the profile that scrambled it, null if that profile is gone. */
  byItem: Map<string, string | null>;
  /** Reload from the database. RLS returns every scrambled item the user can see. */
  load: () => Promise<void>;
  /** Reload soon, coalescing a burst of change events into one query. */
  scheduleLoad: () => void;
  /** Reflect a scramble or unscramble done in this tab without a round trip. */
  setScrambled: (workItemId: string, scrambledBy: string | null | undefined) => void;
}

/** How long to wait for a burst of change events to finish before reloading. */
export const SCRAMBLE_RELOAD_DEBOUNCE_MS = 250;

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export const useScrambledItemsStore = create<ScrambledItemsState>((set, get) => ({
  byItem: new Map(),

  load: async () => {
    // Columns are listed rather than "*" because original_title is not granted
    // to any client role — asking for it would fail the whole query.
    const { data, error } = await supabase.from('work_item_scrambles').select('work_item_id, scrambled_by');
    if (error) {
      console.error('Could not load scrambled items:', error.message);
      return;
    }
    set({ byItem: new Map((data ?? []).map((row) => [row.work_item_id, row.scrambled_by])) });
  },

  scheduleLoad: () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void get().load();
    }, SCRAMBLE_RELOAD_DEBOUNCE_MS);
  },

  setScrambled: (workItemId, scrambledBy) =>
    set((s) => {
      const known = s.byItem.has(workItemId);
      // Leave state untouched when nothing changes, so subscribers don't
      // re-render for a repeat of what they already show.
      if (scrambledBy === undefined ? !known : known && s.byItem.get(workItemId) === scrambledBy) return {};
      const next = new Map(s.byItem);
      if (scrambledBy === undefined) next.delete(workItemId);
      else next.set(workItemId, scrambledBy);
      return { byItem: next };
    }),
}));
