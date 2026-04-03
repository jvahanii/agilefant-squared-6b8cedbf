import { useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';

/**
 * Subscribes to Supabase Realtime Postgres changes for the active organization's
 * work_items, backlogs, and backlog_trees tables. When a row changes in another
 * browser session or by another member of the same org, the Zustand store is
 * updated in-place without a full reload.
 *
 * Shared items (owned by a different org) are still covered by the existing
 * backlog_tree_shares subscription in Index.tsx which triggers a full reload
 * whenever sharing membership changes.
 */
export function useRealtimeSync() {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const applyRealtimeWorkItem = useAppStore((s) => s.applyRealtimeWorkItem);
  const applyRealtimeBacklog = useAppStore((s) => s.applyRealtimeBacklog);
  const applyRealtimeBacklogTree = useAppStore((s) => s.applyRealtimeBacklogTree);

  useEffect(() => {
    if (!activeOrgId) return;

    const channel = supabase
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
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
    // applyRealtime* actions are stable Zustand references; omitting them is intentional.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);
}
