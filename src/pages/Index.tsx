import AppLayout from '@/components/AppLayout';
import { useAppStore } from '@/store/appStore';

const Index = () => {
  const isLoading = useAppStore(s => s.isLoading);
  
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
