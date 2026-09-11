import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

/**
 * Which trees and backlogs currently have a public link, for the markers in
 * the backlog sidebar.
 *
 * Only the targets are loaded, never the tokens: the markers need to know
 * *that* something is published, and a token sitting in client state for every
 * published target would be one more place a working public link could leak
 * from. The dialog fetches the one token it is showing.
 */
interface PublishedLinksState {
  /** Trees published as a whole. */
  trees: Set<string>;
  /** Backlogs published on their own, keyed by backlog id. */
  backlogs: Set<string>;
  /** Reload from the database. RLS returns links for every tree the user can
   *  see, including trees shared from other organizations. */
  load: () => Promise<void>;
  /** Reflect a publish or unpublish done in this tab without a round trip. */
  setPublished: (treeId: string, backlogId: string | null, published: boolean) => void;
}

export const usePublishedLinksStore = create<PublishedLinksState>((set) => ({
  trees: new Set(),
  backlogs: new Set(),

  load: async () => {
    const { data, error } = await supabase.from('published_links').select('tree_id, backlog_id');
    if (error) {
      console.error('Could not load published links:', error.message);
      return;
    }
    const trees = new Set<string>();
    const backlogs = new Set<string>();
    for (const row of data ?? []) {
      if (row.backlog_id) backlogs.add(row.backlog_id);
      else trees.add(row.tree_id);
    }
    set({ trees, backlogs });
  },

  setPublished: (treeId, backlogId, published) =>
    set((s) => {
      const key = backlogId ?? treeId;
      const current = backlogId ? s.backlogs : s.trees;
      // Leave state untouched when nothing changes, so subscribers don't
      // re-render every time a dialog opens and re-confirms what is known.
      if (current.has(key) === published) return {};
      const next = new Set(current);
      if (published) next.add(key);
      else next.delete(key);
      return backlogId ? { backlogs: next } : { trees: next };
    }),
}));
