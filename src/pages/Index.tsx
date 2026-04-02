import { useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useRespawnCheck } from '@/hooks/useRespawnCheck';
import { supabase } from '@/integrations/supabase/client';

const Index = () => {
  const isLoading = useAppStore(s => s.isLoading);
  const setOrganizationId = useAppStore(s => s.setOrganizationId);
  const loadData = useAppStore(s => s.loadFromSupabase);
  const activeOrgId = useOrgStore(s => s.activeOrgId);

  useEffect(() => {
    if (activeOrgId) {
      setOrganizationId(activeOrgId);
      loadData();
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
