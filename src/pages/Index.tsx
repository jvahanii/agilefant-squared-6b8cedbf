import { useEffect } from 'react';
import AppLayout from '@/components/AppLayout';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useRespawnCheck } from '@/hooks/useRespawnCheck';

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
