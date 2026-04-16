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
  useEffect(() => {
    if (!activeOrgId) return;

    const channel = supabase
      .channel(`share-data-reload-${activeOrgId}`)
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'backlog_tree_shares' },
        () => { loadData(); }
      )
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  // loadData is a stable Zustand action reference; omitting it is intentional.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

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
