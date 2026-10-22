import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

/**
 * Which Jira issue each synced work item is: its key and type, and where to
 * open it — and which list is kept in step with which Jira project. Filled by
 * the Jira sync (jira_issue_links, jira_connections); RLS returns the pairs of
 * every item the user can see, and their own organization's connection.
 */
export interface JiraIssueRef {
  key: string;
  type: string;
  /** The issue in Jira, or null where the connection's address is not visible. */
  url: string | null;
  /** Why the sync could not send the item's last change to Jira; null while in step. */
  error: string | null;
}

/** A list kept in step with a Jira project. */
export interface JiraListRef {
  organizationId: string;
  projectKey: string;
  /** The project in Jira. */
  url: string;
}

interface JiraIssuesState {
  byItem: Map<string, JiraIssueRef>;
  /** Backlog id -> the Jira project it is kept in step with. */
  byList: Map<string, JiraListRef>;
  /** Reload from the database. */
  load: () => Promise<void>;
  /** Reload soon, coalescing a burst of change events into one query. */
  scheduleLoad: () => void;
}

/** How long to wait for a burst of change events — a sync writes many — before reloading. */
export const JIRA_RELOAD_DEBOUNCE_MS = 500;

let reloadTimer: ReturnType<typeof setTimeout> | null = null;

export const useJiraIssuesStore = create<JiraIssuesState>((set, get) => ({
  byItem: new Map(),
  byList: new Map(),

  load: async () => {
    // Columns are listed: only these are granted to the app.
    const [links, connections] = await Promise.all([
      supabase.from('jira_issue_links').select('work_item_id, organization_id, jira_key, jira_type, last_error'),
      supabase.from('jira_connections').select('organization_id, base_url, project_key, backlog_id, enabled'),
    ]);
    if (links.error) {
      console.error('Could not load Jira issues:', links.error.message);
      return;
    }
    const baseUrls = new Map((connections.data ?? []).map((c) => [c.organization_id, c.base_url]));
    set({
      byList: new Map(
        (connections.data ?? [])
          .filter((c) => c.enabled)
          .map((c) => [
            c.backlog_id,
            { organizationId: c.organization_id, projectKey: c.project_key, url: `${c.base_url}/browse/${encodeURIComponent(c.project_key)}` },
          ]),
      ),
      byItem: new Map(
        (links.data ?? []).map((row) => {
          const base = baseUrls.get(row.organization_id);
          return [
            row.work_item_id,
            {
              key: row.jira_key,
              type: row.jira_type,
              url: base ? `${base}/browse/${encodeURIComponent(row.jira_key)}` : null,
              error: row.last_error ?? null,
            },
          ];
        }),
      ),
    });
  },

  scheduleLoad: () => {
    if (reloadTimer) clearTimeout(reloadTimer);
    reloadTimer = setTimeout(() => {
      reloadTimer = null;
      void get().load();
    }, JIRA_RELOAD_DEBOUNCE_MS);
  },
}));
