import { useState, useEffect } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useOrgStore } from '@/store/orgStore';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { Trash2, Plus } from 'lucide-react';

interface Share {
  id: string;
  organization_id: string;
  org_name: string;
}

export function ShareTreeDialog({
  treeId,
  treeName,
  open,
  onOpenChange,
}: {
  treeId: string;
  treeName: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const [shares, setShares] = useState<Share[]>([]);
  const [slug, setSlug] = useState('');
  const [loading, setLoading] = useState(false);

  const loadShares = async () => {
    const { data, error } = await supabase
      .from('backlog_tree_shares' as any)
      .select('id, organization_id')
      .eq('tree_id', treeId);
    if (error) { console.error(error); return; }

    const orgIds = (data ?? []).map((s: any) => s.organization_id as string);
    let orgMap = new Map<string, string>();
    if (orgIds.length > 0) {
      const { data: orgs } = await supabase
        .rpc('get_org_names_by_ids', { _ids: orgIds });
      orgMap = new Map((orgs ?? []).map(o => [o.id, o.name]));
    }

    setShares(
      (data ?? []).map((s: any) => ({
        id: s.id,
        organization_id: s.organization_id,
        org_name: orgMap.get(s.organization_id) ?? 'Unknown',
      }))
    );
  };

  useEffect(() => {
    if (open) loadShares();
  }, [open, treeId]);

  const handleAdd = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!slug.trim()) return;
    setLoading(true);

    // Find org by slug
    const { data: orgRows, error: orgErr } = await supabase
      .rpc('lookup_org_by_slug', { _slug: slug.trim().toLowerCase() });
    const org = orgRows?.[0] ?? null;

    if (orgErr || !org) {
      toast({ title: 'Not found', description: 'No organization with that slug.', variant: 'destructive' });
      setLoading(false);
      return;
    }

    if (org.id === activeOrgId) {
      toast({ title: 'Already owner', description: 'This is the owning organization.', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const { error } = await supabase
      .from('backlog_tree_shares' as any)
      .insert({ tree_id: treeId, organization_id: org.id });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Shared!', description: `Tree shared with ${org.name}` });
      setSlug('');
      await loadShares();
    }
    setLoading(false);
  };

  const handleRemove = async (shareId: string) => {
    setLoading(true);
    // Use the RPC function so that the leaving org gets a copy of the tree
    // before the share is deleted (no data is lost).
    const { error } = await (supabase as any).rpc('remove_tree_share_with_copy', { _share_id: shareId });
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Share removed', description: 'The organization now has its own independent copy of the tree.' });
      await loadShares();
    }
    setLoading(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle className="text-base">Share "{treeName}"</DialogTitle>
        </DialogHeader>

        <form onSubmit={handleAdd} className="flex items-end gap-2">
          <div className="flex-1 space-y-1">
            <Label className="text-xs">Organization slug</Label>
            <Input
              value={slug}
              onChange={e => setSlug(e.target.value)}
              placeholder="acme-inc"
              className="h-8 text-sm"
              required
            />
          </div>
          <Button type="submit" size="sm" disabled={loading} className="h-8">
            <Plus className="w-3.5 h-3.5 mr-1" /> Share
          </Button>
        </form>

        {shares.length > 0 && (
          <div className="space-y-2 mt-2">
            <Label className="text-xs text-muted-foreground">Shared with</Label>
            {shares.map(share => (
              <div key={share.id} className="flex items-center justify-between py-1.5 px-2 rounded-md bg-muted/50">
                <div className="flex items-center gap-2">
                  <span className="text-sm">{share.org_name}</span>
                  <Badge variant="outline" className="text-xs">{share.organization_id.slice(0, 8)}</Badge>
                </div>
                <Button variant="ghost" size="sm" className="h-6 w-6 p-0 text-destructive" disabled={loading} onClick={() => handleRemove(share.id)}>
                  <Trash2 className="w-3.5 h-3.5" />
                </Button>
              </div>
            ))}
          </div>
        )}

        {shares.length === 0 && (
          <p className="text-xs text-muted-foreground text-center py-2">Not shared with any organizations yet.</p>
        )}
      </DialogContent>
    </Dialog>
  );
}
