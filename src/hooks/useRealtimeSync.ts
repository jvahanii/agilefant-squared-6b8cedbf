import { useEffect } from 'react';
import type { RealtimePostgresChangesPayload } from '@supabase/supabase-js';
import { supabase } from '@/integrations/supabase/client';
import { getCurrentUserId } from '@/lib/currentUser';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useTeamStore } from '@/store/teamStore';
import { useOrgSettingsStore } from '@/store/orgSettingsStore';
import { useLabelsStore } from '@/store/labelsStore';
import { useBacklogStatusesStore } from '@/store/backlogStatusesStore';
import { useSnoozeStore } from '@/store/snoozeStore';
import { useFinancialsStore } from '@/store/financialsStore';
import { useTargetsStore } from '@/store/targetsStore';
import { noteVisibilityChange, subscribeWithHealth } from '@/lib/realtimeHealth';
import { usePublishedLinksStore } from '@/store/publishedLinksStore';
import { useScrambledItemsStore } from '@/store/scrambledItemsStore';
import { useJiraIssuesStore } from '@/store/jiraIssuesStore';
import { useScrambledListsStore } from '@/store/scrambledListsStore';
import { readOutgoingShares } from '@/store/supabaseSync';

type Change = 'INSERT' | 'UPDATE' | 'DELETE';
type Row = Record<string, unknown>;
type Payload = RealtimePostgresChangesPayload<Row>;

/** The row a change is about: the old one for a deletion. */
const rowOf = (payload: Payload) => (payload.eventType === 'DELETE' ? payload.old : payload.new) as Row;

// What this organisation can see, read when a change arrives: the store holds
// only what comes from trees it has access to.
const visibleTrees = () => new Set(Object.keys(useAppStore.getState().backlogTrees));
const inVisibleTree = (assignments: unknown) => {
  const trees = visibleTrees();
  return Object.keys((assignments as Record<string, string> | null | undefined) ?? {}).some((tid) => trees.has(tid));
};
const itemIsHere = (row: Row) => !!useAppStore.getState().workItems[row.work_item_id as string];

/**
 * A table every organisation's channel listens to, filtered to that
 * organisation's rows: what a change to it does to the stores.
 */
interface OrgTable {
  table: string;
  /** What a change does, given its row; or, with `whole`, given all of it. */
  apply?: (change: Change, row: Row) => void;
  whole?: (payload: Payload) => void;
  /**
   * A partner's change is applied only when this says the row is in a tree we
   * can see. Deletions always are: a row we never had is simply not found.
   * Absent: every change is applied.
   */
  partnerSees?: (row: Row) => boolean;
  /** Our own organisation's only: partners never add trees or settings of ours. */
  ownOnly?: boolean;
}

const ORG_TABLES: OrgTable[] = [
  {
    table: 'work_items',
    apply: (c, r) => useAppStore.getState().applyRealtimeWorkItem(c, r),
    partnerSees: (r) => inVisibleTree(r.backlog_assignments),
  },
  {
    table: 'backlogs',
    apply: (c, r) => useAppStore.getState().applyRealtimeBacklog(c, r),
    partnerSees: (r) => visibleTrees().has(r.tree_id as string),
  },
  {
    table: 'backlog_trees',
    apply: (c, r) => useAppStore.getState().applyRealtimeBacklogTree(c, r),
    ownOnly: true,
  },
  {
    table: 'work_item_hyperlinks',
    apply: (c, r) => useAppStore.getState().applyRealtimeHyperlink(c, r),
    // Its item is here, in a shared tree we have access to.
    partnerSees: (r) => inVisibleTree(useAppStore.getState().workItems[r.work_item_id as string]?.backlogAssignments),
  },
  {
    table: 'work_item_backlog_ranks',
    apply: (c, r) => useAppStore.getState().applyRealtimeWorkItemRank(c, r),
    partnerSees: itemIsHere,
  },
  {
    table: 'work_item_board_ranks',
    apply: (c, r) => useAppStore.getState().applyRealtimeWorkItemBoardRank(c, r),
    partnerSees: itemIsHere,
  },
  {
    table: 'time_entries',
    apply: (c, r) => useTimeEntryStore.getState().applyRealtimeTimeEntry(c, r),
    // The item or list it is logged on is here. The store is filled only from
    // accessible trees, so that is proof enough of access.
    partnerSees: (r) => {
      const state = useAppStore.getState();
      if (r.work_item_id) return !!state.workItems[r.work_item_id as string];
      if (r.backlog_id) return !!state.backlogs[r.backlog_id as string];
      return false;
    },
  },
  {
    table: 'work_item_team_assignments',
    apply: (c, r) => useTeamStore.getState().applyRealtimeTeamAssignment(c, r),
  },
  {
    table: 'teams',
    apply: (c, r) => useTeamStore.getState().applyRealtimeTeam(c, r),
  },
  {
    table: 'work_item_financials',
    apply: (c, r) => useFinancialsStore.getState().applyRealtime(c, r),
    partnerSees: itemIsHere,
  },
  {
    table: 'organization_settings',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    whole: (payload) => useOrgSettingsStore.getState().applyRealtimeSettings(payload as any),
    ownOnly: true,
  },
  {
    table: 'labels',
    apply: (c, r) => useLabelsStore.getState().applyRealtimeLabel(c, r),
  },
  {
    table: 'label_assignments',
    apply: (c, r) => useLabelsStore.getState().applyRealtimeAssignment(c, r),
  },
];

/**
 * Tables that ride on our own channel without a filter: RLS already limits
 * what the subscriber may see. A channel takes any number of bindings, and
 * each extra channel costs Realtime a subscription row plus a publication
 * re-check every time it subscribes — 100k of those checks were the biggest
 * single consumer of database time.
 */
const OWN_UNFILTERED: Array<{ table: string; on: (payload: Payload) => void }> = [
  {
    // Backlog statuses: RLS restricts to accessible backlogs.
    table: 'backlog_statuses',
    on: (payload) => {
      const row = rowOf(payload);
      const backlogId = row?.backlog_id as string | undefined;
      if (!backlogId || !useAppStore.getState().backlogs[backlogId]) return;
      useBacklogStatusesStore.getState().applyRealtimeStatus(payload.eventType, row);
    },
  },
  // Public links: any change reloads which trees and backlogs are published.
  // The event's contents are deliberately ignored -- on a table with RLS a
  // DELETE carries only the primary key, which here is the token, so it could
  // not say which marker to drop. The reload asks the database instead,
  // debounced so a cascade costs one query.
  { table: 'published_links', on: () => usePublishedLinksStore.getState().scheduleLoad() },
  // Scrambled item names: same shape, same reason.
  { table: 'work_item_scrambles', on: () => useScrambledItemsStore.getState().scheduleLoad() },
  // Which Jira issue each item is: same shape, same reason.
  { table: 'jira_issue_links', on: () => useJiraIssuesStore.getState().scheduleLoad() },
  // And the connection: its hierarchy levels change when Jira's do.
  { table: 'jira_connections', on: () => useJiraIssuesStore.getState().scheduleLoad() },
  // And scrambled lists.
  { table: 'backlog_scrambles', on: () => useScrambledListsStore.getState().scheduleLoad() },
  {
    // Per-tree yearly financial targets, filtered to accessible trees here.
    table: 'tree_financial_targets',
    on: (payload) => {
      const row = rowOf(payload);
      const treeId = row?.tree_id as string | undefined;
      if (!treeId || !visibleTrees().has(treeId)) return;
      useTargetsStore.getState().applyRealtime(payload.eventType, row);
    },
  },
];

/** A Realtime filter for rows of these organisations. */
function orgFilter(orgIds: string[]): string {
  return orgIds.length === 1 ? `organization_id=eq.${orgIds[0]}` : `organization_id=in.(${orgIds.join(',')})`;
}

/**
 * One channel for our organisation's changes and those of every partner that
 * shares trees with us: one binding per table, filtered to all of them.
 *
 * Each binding is a subscription Realtime checks every change against, so a
 * channel per partner multiplied them: 45 for an organisation with two
 * partners, where this makes 21. A partner's change is applied only where it
 * touches what we can see (OrgTable.partnerSees); whose it is, the row says.
 * A deletion carries only the primary key, and is always applied, as before:
 * a row we never had is simply not found.
 */
function buildOrgChannel(name: string, ownOrgId: string, partnerOrgIds: string[]) {
  const channel = supabase.channel(name);
  const allOrgIds = [ownOrgId, ...partnerOrgIds];
  for (const t of ORG_TABLES) {
    channel.on(
      'postgres_changes',
      { event: '*', schema: 'public', table: t.table, filter: orgFilter(t.ownOnly ? [ownOrgId] : allOrgIds) },
      (payload: Payload) => {
        if (t.whole) {
          t.whole(payload);
          return;
        }
        const row = rowOf(payload);
        const fromPartner = payload.eventType !== 'DELETE' && row.organization_id !== ownOrgId;
        if (fromPartner && t.partnerSees && !t.partnerSees(row)) return;
        t.apply?.(payload.eventType, row);
      },
    );
  }
  for (const t of OWN_UNFILTERED) {
    channel.on('postgres_changes', { event: '*', schema: 'public', table: t.table }, t.on);
  }
  return channel;
}

/**
 * Subscribes to Supabase Realtime Postgres changes for the active
 * organization's tables (ORG_TABLES and OWN_UNFILTERED). When a row changes
 * in another browser session or by another member of the same org, the
 * stores are updated in place without a full reload.
 *
 * Additionally subscribes to the same tables for every "partner" organization
 * that participates in tree sharing with the active org:
 *  - Incoming partners: orgs that own trees shared TO us (derived from backlogTrees
 *    state – any tree whose ID prefix differs from activeOrgId).
 *  - Outgoing partners: orgs that have access to OUR trees (fetched once from
 *    backlog_tree_shares when the effect runs).
 *
 * This ensures that when a partner org creates/updates/deletes items in a shared
 * tree those changes appear immediately in the active org's UI without a manual
 * page reload.
 */
export function useRealtimeSync() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const backlogTrees = useAppStore((s) => s.backlogTrees);

  // Coming back to the tab: reconnect if the socket died while it was hidden,
  // and after a long absence catch up on what was missed. Nothing did this
  // before, so a tab whose socket had quietly gone showed no new items until
  // it was reloaded.
  useEffect(() => {
    if (typeof document === 'undefined') return;
    const onVisibility = () => noteVisibilityChange(document.visibilityState);
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  // Re-subscribing tears down every channel and builds it again, and each
  // subscribe costs Realtime a publication re-check. Only the *partner*
  // organizations matter to what is subscribed: a tree added, renamed or
  // removed inside the active org changes nothing about the channels, so
  // keying on the partner set alone keeps a working session from churning.
  const partnerOrgsKey = (() => {
    const partners = new Set<string>();
    for (const treeId of Object.keys(backlogTrees)) {
      const sep = treeId.indexOf('::');
      if (sep > 0) {
        const owner = treeId.slice(0, sep);
        if (owner !== activeOrgId) partners.add(owner);
      }
    }
    return [...partners].sort().join(',');
  })();

  // Trees load after the first render, so on a fresh page load this effect
  // first runs with none of our own. Outgoing shares are looked up from our
  // tree IDs, so without re-running once they arrive, the organizations we
  // share trees *out* to would never get a channel until the page reloaded.
  // A flag rather than the tree IDs: it flips once, instead of churning every
  // channel whenever a tree is added or removed.
  const hasOwnTrees = Object.keys(backlogTrees).some((id) => id.startsWith(`${activeOrgId}::`));

  useEffect(() => {
    if (!activeOrgId) return;

    const accessibleTreeIds = new Set(Object.keys(useAppStore.getState().backlogTrees));

    // Derive incoming partner org IDs synchronously from tree IDs that belong
    // to a different org (format: "<ownerOrgId>::<rawId>").
    const incomingPartnerOrgIds = new Set<string>();
    for (const treeId of accessibleTreeIds) {
      const sep = treeId.indexOf('::');
      if (sep > 0) {
        const ownerOrg = treeId.slice(0, sep);
        if (ownerOrg !== activeOrgId) incomingPartnerOrgIds.add(ownerOrg);
      }
    }

    // Every subscription is tracked here so the cleanup function can remove it
    // regardless of whether it was created synchronously or asynchronously.
    // Each one is given a builder rather than a channel: a channel that closes
    // is replaced by a fresh one, since realtime-js joins an instance only once.
    const unsubscribers: Array<() => void> = [];
    let destroyed = false;

    // Per-user snoozes (RLS already restricts to current user; no org filter needed).
    // Async: fetch the current user's id once, then subscribe filtered by it.
    (async () => {
      const userId = await getCurrentUserId();
      if (!userId || destroyed) return;
      const buildSnoozeChannel = () =>
        supabase
          .channel(`work-item-snoozes-${userId}`)
          .on(
            'postgres_changes',
            { event: '*', schema: 'public', table: 'work_item_snoozes', filter: `user_id=eq.${userId}` },
            (payload: Payload) => useSnoozeStore.getState().applyRealtimeSnooze(payload.eventType, rowOf(payload)),
          );
      unsubscribers.push(subscribeWithHealth(buildSnoozeChannel));
    })();

    // One channel for our organisation and every partner: incoming ones from
    // the tree IDs, outgoing ones (orgs that have access to our trees) read
    // first, so the channel is subscribed once with all of them rather than
    // again when they arrive. The read is the load's own, shared with it
    // (readOutgoingShares), so it is usually answered already.
    (async () => {
      const partners = new Set(incomingPartnerOrgIds);
      const ourTreeIds = [...accessibleTreeIds].filter((id) => id.startsWith(`${activeOrgId}::`));
      if (ourTreeIds.length > 0) {
        const { data, error } = await readOutgoingShares(ourTreeIds);
        if (error) {
          // Still listen to our own and the incoming partners' changes.
          console.error('useRealtimeSync: failed to fetch outgoing tree shares', error);
        } else {
          for (const row of (data ?? []) as Array<{ organization_id: string }>) {
            if (row.organization_id !== activeOrgId) partners.add(row.organization_id);
          }
        }
      }
      if (destroyed) return;
      const partnerOrgIds = [...partners].sort();
      unsubscribers.push(
        subscribeWithHealth(() => buildOrgChannel(`entity-realtime-${activeOrgId}`, activeOrgId, partnerOrgIds)),
      );
    })();

    return () => {
      destroyed = true;
      for (const unsubscribe of unsubscribers) unsubscribe();
    };
    // partnerOrgsKey re-subscribes when an organization starts or stops sharing
    // trees with this one — the only change that alters which channels exist.
    // A tree shared *out* after this ran is picked up by the next resync rather
    // than by rebuilding every channel on each tree edit.
  }, [activeOrgId, partnerOrgsKey, hasOwnTrees]);
}
