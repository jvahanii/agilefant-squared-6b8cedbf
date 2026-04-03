import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { useAuth } from '@/hooks/useAuth';
import { useOrgStore } from '@/store/orgStore';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export default function Onboarding() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const { createOrganization, loadMemberships } = useOrgStore();
  const [loading, setLoading] = useState(false);

  return (
    <div className="min-h-screen flex items-center justify-center bg-background p-4">
      <Card className="w-full max-w-md">
        <CardHeader className="text-center">
          <CardTitle>Welcome to Agilefant<sup className="text-primary">2</sup></CardTitle>
          <CardDescription>Create or join an organization to get started</CardDescription>
        </CardHeader>
        <CardContent>
          <Tabs defaultValue="create">
            <TabsList className="grid w-full grid-cols-2">
              <TabsTrigger value="create">Create Organization</TabsTrigger>
              <TabsTrigger value="join">Join via Invite</TabsTrigger>
            </TabsList>
            <TabsContent value="create">
              <CreateOrgForm
                loading={loading}
                onSubmit={async (name, slug) => {
                  if (!user) return;
                  setLoading(true);
                  try {
                    await createOrganization(name, slug, user.id);
                    await loadMemberships(user.id);
                    toast({ title: 'Organization created!' });
                    navigate('/', { replace: true });
                  } catch (err: any) {
                    toast({ title: 'Error', description: err.message, variant: 'destructive' });
                  }
                  setLoading(false);
                }}
              />
            </TabsContent>
            <TabsContent value="join">
              <div className="text-center py-8 text-muted-foreground text-sm">
                <p>Ask your team admin to invite you.</p>
                <p className="mt-2">Once invited, refresh this page.</p>
                <Button variant="outline" className="mt-4" onClick={() => user && loadMemberships(user.id)}>
                  Refresh
                </Button>
              </div>
            </TabsContent>
          </Tabs>
        </CardContent>
      </Card>
    </div>
  );
}

function CreateOrgForm({ loading, onSubmit }: { loading: boolean; onSubmit: (name: string, slug: string) => void }) {
  const [name, setName] = useState('');
  const [slug, setSlug] = useState('');

  const handleNameChange = (val: string) => {
    setName(val);
    setSlug(val.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''));
  };

  return (
    <form
      onSubmit={e => { e.preventDefault(); onSubmit(name, slug); }}
      className="space-y-4 mt-4"
    >
      <div className="space-y-2">
        <Label>Organization Name</Label>
        <Input value={name} onChange={e => handleNameChange(e.target.value)} required placeholder="Acme Inc." />
      </div>
      <div className="space-y-2">
        <Label>URL Slug</Label>
        <Input value={slug} onChange={e => setSlug(e.target.value)} required placeholder="acme-inc" pattern="[a-z0-9\-]+" />
        <p className="text-xs text-muted-foreground">Only lowercase letters, numbers, and hyphens</p>
      </div>
      <Button type="submit" className="w-full" disabled={loading || !name || !slug}>
        {loading ? 'Creating...' : 'Create Organization'}
      </Button>
    </form>
  );
}
