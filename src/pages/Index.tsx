import { useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTeamStore } from '@/store/teamStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useRespawnCheck } from '@/hooks/useRespawnCheck';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrgSettingsStore, isTimeLoggingEnabled } from '@/store/orgSettingsStore';
import { useLabelsStore } from '@/store/labelsStore';
import { useTreeStatusesStore } from '@/store/treeStatusesStore';

const Index = () => {
  const isLoading = useAppStore(s => s.isLoading);
  const setOrganizationId = useAppStore(s => s.setOrganizationId);
  const setUser = useAppStore(s => s.setUser);
  const loadData = useAppStore(s => s.loadFromSupabase);
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const loadTeams = useTeamStore(s => s.loadTeams);
  const loadWorkItemTeams = useTeamStore(s => s.loadWorkItemTeams);
  const loadTimeEntries = useTimeEntryStore(s => s.loadTimeEntries);
  const { user } = useAuth();
  const loadSettings = useOrgSettingsStore(s => s.loadSettings);
  const loadLabels = useLabelsStore(s => s.loadLabels);
  const loadStatusesForTrees = useTreeStatusesStore(s => s.loadStatusesForTrees);
  const backlogTrees = useAppStore(s => s.backlogTrees);

  useEffect(() => {
    if (user) {
      setUser(user.id, user.email ?? '');
    }
  }, [user]);

  useEffect(() => {
    if (activeOrgId) {
      setOrganizationId(activeOrgId);
      loadData();
      loadTeams(activeOrgId);
      loadWorkItemTeams(activeOrgId);
      loadSettings(activeOrgId).then(() => {
        if (isTimeLoggingEnabled(activeOrgId)) {
          loadTimeEntries(activeOrgId);
        }
      });
    }
  }, [activeOrgId]);

  // Reload data whenever share membership changes so both the tree owner and
  // the newly-shared org see each other's trees and contents immediately.
  // Also reload time entries so partner-org logged time becomes visible.
  useEffect(() => {
    if (!activeOrgId) return;

    const channel = supabase
      .channel(`share-data-reload-${activeOrgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'backlog_tree_shares' },
        () => {
          loadData().then(() => {
            if (isTimeLoggingEnabled(activeOrgId)) {
              loadTimeEntries(activeOrgId);
            }
          });
        }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // loadData and loadTimeEntries are stable Zustand action references; omitting them is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  // Load labels for active org + any partner orgs whose trees are accessible.
  const treeIdsKey = Object.keys(backlogTrees).sort().join(',');
  useEffect(() => {
    if (!activeOrgId) return;
    const orgIds = new Set<string>([activeOrgId]);
    for (const treeId of Object.keys(backlogTrees)) {
      const sep = treeId.indexOf('::');
      if (sep > 0) orgIds.add(treeId.slice(0, sep));
    }
    loadLabels([...orgIds]);
    // Load per-tree status definitions for every accessible tree
    const treeIds = Object.keys(backlogTrees);
    if (treeIds.length > 0) loadStatusesForTrees(treeIds);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, treeIdsKey]);

  useRespawnCheck();
  useRealtimeSync();

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen bg-background text-foreground">
        <p className="text-muted-foreground">Loading...</p>
      </div>
    );
  }

  return <AppLayout />;
};

export default Index;
