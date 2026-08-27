import { useEffect, useRef } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTeamStore } from '@/store/teamStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useRespawnCheck } from '@/hooks/useRespawnCheck';
import { useRealtimeSync } from '@/hooks/useRealtimeSync';
import { useResyncOnWake } from '@/hooks/useResyncOnWake';
import { usePasteImageOnSelected } from '@/hooks/usePasteImageOnSelected';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrgSettingsStore, isTimeLoggingEnabled } from '@/store/orgSettingsStore';
import { useLabelsStore } from '@/store/labelsStore';
import { useBacklogStatusesStore } from '@/store/backlogStatusesStore';
import { useSnoozeStore, startSnoozeExpiryWatcher } from '@/store/snoozeStore';
import { AppShellSkeleton } from '@/components/AppShellSkeleton';

const Index = () => {
  const isLoading = useAppStore(s => s.isLoading);
  const loadingProgress = useAppStore(s => s.loadingProgress);
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
  const loadStatusesForOrgs = useBacklogStatusesStore(s => s.loadStatusesForOrgs);
  const backlogTrees = useAppStore(s => s.backlogTrees);
  const loadSnoozes = useSnoozeStore(s => s.loadSnoozes);
  const clearSnoozes = useSnoozeStore(s => s.clearSnoozes);

  useEffect(() => {
    if (user) {
      setUser(user.id, user.email ?? '');
      loadSnoozes();
    } else {
      clearSnoozes();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  // Periodically tick so expired snoozes wake up in the UI.
  useEffect(() => {
    return startSnoozeExpiryWatcher();
  }, []);

  useEffect(() => {
    // Defer the supporting stores until the core snapshot has loaded so these
    // requests don't compete with loadFromSupabase for mobile bandwidth. The
    // app shell becomes interactive first, then the supporting data streams in.
    if (activeOrgId && !isLoading) {
      // Note: setOrganizationId + loadData() are already triggered by the
      // useOrgStore.subscribe block in App.tsx before this effect runs, so we
      // intentionally don't call them here — doing so would double-fetch the
      // entire dataset on every org switch.
      loadTeams(activeOrgId);
      loadWorkItemTeams(activeOrgId);
      loadSettings(activeOrgId).then(() => {
        if (isTimeLoggingEnabled(activeOrgId)) {
          loadTimeEntries(activeOrgId);
        }
      });
    }
  }, [activeOrgId, isLoading]);

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
    if (!activeOrgId || isLoading) return;
    const orgIds = new Set<string>([activeOrgId]);
    for (const treeId of Object.keys(backlogTrees)) {
      const sep = treeId.indexOf('::');
      if (sep > 0) orgIds.add(treeId.slice(0, sep));
    }
    loadLabels([...orgIds]);
    // Load savings/income financials for the active + partner orgs.
    import('@/store/financialsStore').then(({ useFinancialsStore }) =>
      useFinancialsStore.getState().load([...orgIds]),
    );
    // Load per-tree yearly financial targets.
    import('@/store/targetsStore').then(({ useTargetsStore }) =>
      useTargetsStore.getState().load([...orgIds]),
    );
    // Load daily FX rates for currency conversion (cached per UTC day).
    import('@/store/ratesStore').then(({ useRatesStore }) =>
      useRatesStore.getState().load(),
    );
    // Load per-backlog status definitions for the active + partner orgs.
    loadStatusesForOrgs([...orgIds]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId, treeIdsKey, isLoading]);

  // Keep a stable ref so the visibility handler always reads the latest
  // isLoading value without needing it as an effect dependency (which would
  // re-register the listener on every load-state change).
  const isLoadingRef = useRef(isLoading);
  isLoadingRef.current = isLoading;
  const visibilityRetryRef = useRef<string | null>(null);

  // On mobile, iOS Safari may restore the page from bfcache (back-forward
  // cache) or bring it out of background suspension with in-flight Supabase
  // requests silently cancelled and the safety setTimeout still paused.  The
  // result is a page stuck on "Loading…".  Re-triggering the data fetch when
  // the document becomes visible again clears the stuck state.
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState !== 'visible' || !activeOrgId || !isLoadingRef.current) return;
      const retryKey = `${activeOrgId}:visible-loading`;
      if (visibilityRetryRef.current === retryKey) return;
      visibilityRetryRef.current = retryKey;
      setOrganizationId(activeOrgId);
      loadData();
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange);
    // activeOrgId is the only value used directly; setOrganizationId and loadData
    // are stable Zustand references that never change identity.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeOrgId]);

  useEffect(() => {
    if (!activeOrgId || !isLoading) visibilityRetryRef.current = null;
  }, [activeOrgId, isLoading]);

  useRespawnCheck();
  useRealtimeSync();
  useResyncOnWake();
  usePasteImageOnSelected();

  if (isLoading) {
    return <AppShellSkeleton progress={loadingProgress} />;
  }


  return <AppLayout />;
};

export default Index;
