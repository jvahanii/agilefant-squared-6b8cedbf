import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useTeamStore } from '@/store/teamStore';

/**
 * Subscribes to Supabase Realtime Postgres changes for the active organization's
 * work_items, backlogs, backlog_trees, and work_item_hyperlinks tables. When a
 * row changes in another browser session or by another member of the same org,
 * the Zustand store is updated in-place without a full reload.
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
  const applyRealtimeWorkItem = useAppStore((s) => s.applyRealtimeWorkItem);
  const applyRealtimeWorkItemRank = useAppStore((s) => s.applyRealtimeWorkItemRank);
  const applyRealtimeBacklog = useAppStore((s) => s.applyRealtimeBacklog);
  const applyRealtimeBacklogTree = useAppStore((s) => s.applyRealtimeBacklogTree);
  const applyRealtimeHyperlink = useAppStore((s) => s.applyRealtimeHyperlink);
  const applyRealtimeTimeEntry = useTimeEntryStore((s) => s.applyRealtimeTimeEntry);
  const applyRealtimeTeamAssignment = useTeamStore((s) => s.applyRealtimeTeamAssignment);
  const applyRealtimeTeam = useTeamStore((s) => s.applyRealtimeTeam);

  // Stable serialized key so the effect re-runs only when the set of accessible
  // tree IDs actually changes (i.e. sharing membership changes).
  const treeIdsKey = Object.keys(backlogTrees).sort().join(',');

  useEffect(() => {
    if (!activeOrgId) return;

    const accessibleTreeIds = new Set(Object.keys(backlogTrees));

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

    // All channels are tracked here so the cleanup function can remove them
    // regardless of whether they were created synchronously or asynchronously.
    const channels: ReturnType<typeof supabase.channel>[] = [];
    let destroyed = false;

    // Helper: subscribe a channel that monitors work_items, backlogs, and
    // work_item_hyperlinks for a partner org.  A JS-side filter ensures we only
    // apply changes that reference trees the active org can actually access.
    function subscribePartnerOrg(orgId: string) {
      const channel = supabase
        .channel(`entity-realtime-${activeOrgId}-partner-${orgId}`)
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_items',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if this item is assigned to at least one accessible tree.
              const assignments = (row.backlog_assignments as Record<string, string>) ?? {};
              const currentTrees = new Set(Object.keys(useAppStore.getState().backlogTrees));
              if (!Object.keys(assignments).some((tid) => currentTrees.has(tid))) return;
            }
            applyRealtimeWorkItem(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'backlogs',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if this backlog belongs to an accessible tree.
              const currentTrees = new Set(Object.keys(useAppStore.getState().backlogTrees));
              if (!currentTrees.has(row.tree_id as string)) return;
            }
            applyRealtimeBacklog(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_hyperlinks',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if the parent work item is in our store (i.e. it
              // belongs to a shared tree we have access to).
              const workItemId = row.work_item_id as string;
              const assignments = useAppStore.getState().workItems[workItemId]?.backlogAssignments ?? {};
              const currentTrees = new Set(Object.keys(useAppStore.getState().backlogTrees));
              if (!Object.keys(assignments).some((tid) => currentTrees.has(tid))) return;
            }
            applyRealtimeHyperlink(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_backlog_ranks',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            if (payload.eventType !== 'DELETE') {
              // Only apply if the work item is in our store.
              const workItemId = row.work_item_id as string;
              if (!useAppStore.getState().workItems[workItemId]) return;
            }
            applyRealtimeWorkItemRank(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'work_item_team_assignments',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            applyRealtimeTeamAssignment(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .on(
          'postgres_changes',
          {
            event: '*',
            schema: 'public',
            table: 'teams',
            filter: `organization_id=eq.${orgId}`,
          },
          (payload) => {
            const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
            applyRealtimeTeam(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
          },
        )
        .subscribe();
      channels.push(channel);
    }

    // Own-org channel (includes backlog_trees; partner orgs only ever add
    // work_items / backlogs to shared trees, never new backlog_trees).
    const ownChannel = supabase
      .channel(`entity-realtime-${activeOrgId}`)
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_items',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeWorkItem(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'backlogs',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeBacklog(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'backlog_trees',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeBacklogTree(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_hyperlinks',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeHyperlink(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_backlog_ranks',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeWorkItemRank(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'time_entries',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeTimeEntry(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'work_item_team_assignments',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeTeamAssignment(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .on(
        'postgres_changes',
        {
          event: '*',
          schema: 'public',
          table: 'teams',
          filter: `organization_id=eq.${activeOrgId}`,
        },
        (payload) => {
          const row = (payload.eventType === 'DELETE' ? payload.old : payload.new) as Record<string, unknown>;
          applyRealtimeTeam(payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE', row);
        },
      )
      .subscribe();
    channels.push(ownChannel);

    // Subscribe to incoming partner orgs synchronously (no extra DB query needed).
    for (const orgId of incomingPartnerOrgIds) {
      subscribePartnerOrg(orgId);
    }

    // Async: fetch outgoing partner org IDs (orgs that have access to our trees)
    // and subscribe to them as well.
    async function subscribeOutgoingPartners() {
      const ourTreeIds = [...accessibleTreeIds].filter((id) => id.startsWith(`${activeOrgId}::`));
      if (ourTreeIds.length === 0) return;

      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any)
        .from('backlog_tree_shares')
        .select('organization_id')
        .in('tree_id', ourTreeIds);

      if (error) {
        console.error('useRealtimeSync: failed to fetch outgoing tree shares', error);
        return;
      }

      if (destroyed) return;

      for (const row of (data ?? []) as Array<{ organization_id: string }>) {
        const orgId = row.organization_id;
        // Skip if already subscribed (incoming partner) or is the active org.
        if (orgId === activeOrgId || incomingPartnerOrgIds.has(orgId)) continue;
        subscribePartnerOrg(orgId);
      }
    }

    subscribeOutgoingPartners();

    return () => {
      destroyed = true;
      for (const ch of channels) supabase.removeChannel(ch);
    };
    // applyRealtime* actions are stable Zustand references; omitting them is intentional.
    // treeIdsKey captures changes to accessible tree IDs so the effect re-subscribes
    // whenever sharing membership changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, treeIdsKey]);
}
