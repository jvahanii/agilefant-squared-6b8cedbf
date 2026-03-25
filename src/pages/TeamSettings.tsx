import { useEffect, useState } from 'react';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { useOrgStore } from '@/store/orgStore';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { toast } from '@/hooks/use-toast';
import { ArrowLeft, UserPlus, Trash2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

interface Member {
  id: string;
  user_id: string;
  email: string;
  full_name: string;
  role: 'owner' | 'admin' | 'member';
}

export default function TeamSettings() {
  const { user } = useAuth();
  const navigate = useNavigate();
  const activeOrgId = useOrgStore(s => s.activeOrgId);
  const activeOrg = useOrgStore(s => s.getActiveOrg());
  const loadMemberships = useOrgStore(s => s.loadMemberships);
  const [members, setMembers] = useState<Member[]>([]);
  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'member' | 'admin'>('member');
  const [loading, setLoading] = useState(false);

  const currentRole = activeOrg?.role;
  const canManage = currentRole === 'owner' || currentRole === 'admin';

  useEffect(() => {
    if (!activeOrgId) return;
    loadMembers();
  }, [activeOrgId]);

  const loadMembers = async () => {
    if (!activeOrgId) return;
    const { data, error } = await supabase
      .from('memberships')
      .select('id, user_id, role')
      .eq('organization_id', activeOrgId);
    if (error) { console.error(error); return; }

    // Load profiles for these users
    const userIds = data.map(m => m.user_id);
    const { data: profiles } = await supabase
      .from('profiles')
      .select('id, email, full_name')
      .in('id', userIds);

    const profileMap = new Map((profiles ?? []).map(p => [p.id, p]));
    setMembers(data.map(m => ({
      id: m.id,
      user_id: m.user_id,
      email: profileMap.get(m.user_id)?.email ?? '',
      full_name: profileMap.get(m.user_id)?.full_name ?? '',
      role: m.role as Member['role'],
    })));
  };

  const handleInvite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!activeOrgId || !inviteEmail) return;
    setLoading(true);

    // Find user by email in profiles
    const { data: profile, error: profileErr } = await supabase
      .from('profiles')
      .select('id')
      .eq('email', inviteEmail)
      .maybeSingle();

    if (profileErr || !profile) {
      toast({ title: 'User not found', description: 'The user must sign up first before being invited.', variant: 'destructive' });
      setLoading(false);
      return;
    }

    const { error } = await supabase
      .from('memberships')
      .insert({ user_id: profile.id, organization_id: activeOrgId, role: inviteRole });

    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Member added!' });
      setInviteEmail('');
      await loadMembers();
    }
    setLoading(false);
  };

  const handleRemove = async (membershipId: string, memberUserId: string) => {
    if (memberUserId === user?.id) {
      if (!confirm('Are you sure you want to leave this organization?')) return;
    }
    const { error } = await supabase.from('memberships').delete().eq('id', membershipId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      toast({ title: 'Member removed' });
      if (memberUserId === user?.id) {
        await loadMemberships(user.id);
        navigate('/');
      } else {
        await loadMembers();
      }
    }
  };

  const handleRoleChange = async (membershipId: string, newRole: string) => {
    const { error } = await supabase
      .from('memberships')
      .update({ role: newRole as any })
      .eq('id', membershipId);
    if (error) {
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
    } else {
      await loadMembers();
    }
  };

  const roleBadgeColor = (role: string) => {
    switch (role) {
      case 'owner': return 'default';
      case 'admin': return 'secondary';
      default: return 'outline';
    }
  };

  return (
    <div className="min-h-screen bg-background p-6">
      <div className="max-w-2xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <Button variant="ghost" size="sm" onClick={() => navigate('/')}>
            <ArrowLeft className="w-4 h-4 mr-1" /> Back
          </Button>
          <h1 className="text-xl font-bold">Team Settings — {activeOrg?.organization_name}</h1>
        </div>

        {canManage && (
          <Card>
            <CardHeader>
              <CardTitle className="text-base flex items-center gap-2">
                <UserPlus className="w-4 h-4" /> Invite Member
              </CardTitle>
            </CardHeader>
            <CardContent>
              <form onSubmit={handleInvite} className="flex items-end gap-3">
                <div className="flex-1 space-y-1">
                  <Label>Email</Label>
                  <Input
                    type="email"
                    value={inviteEmail}
                    onChange={e => setInviteEmail(e.target.value)}
                    placeholder="colleague@example.com"
                    required
                  />
                </div>
                <div className="space-y-1">
                  <Label>Role</Label>
                  <Select value={inviteRole} onValueChange={v => setInviteRole(v as 'member' | 'admin')}>
                    <SelectTrigger className="w-28">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="member">Member</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button type="submit" disabled={loading}>
                  {loading ? 'Adding...' : 'Add'}
                </Button>
              </form>
            </CardContent>
          </Card>
        )}

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Members ({members.length})</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="divide-y">
              {members.map(member => (
                <div key={member.id} className="flex items-center justify-between py-3">
                  <div>
                    <p className="text-sm font-medium">
                      {member.full_name || member.email}
                      {member.user_id === user?.id && <span className="text-muted-foreground ml-1">(you)</span>}
                    </p>
                    <p className="text-xs text-muted-foreground">{member.email}</p>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && currentRole === 'owner' && member.user_id !== user?.id ? (
                      <Select value={member.role} onValueChange={v => handleRoleChange(member.id, v)}>
                        <SelectTrigger className="w-24 h-8 text-xs">
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="member">Member</SelectItem>
                          <SelectItem value="admin">Admin</SelectItem>
                          <SelectItem value="owner">Owner</SelectItem>
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant={roleBadgeColor(member.role) as any}>{member.role}</Badge>
                    )}
                    {(canManage || member.user_id === user?.id) && member.role !== 'owner' && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleRemove(member.id, member.user_id)}
                        className="text-destructive hover:text-destructive"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </Button>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
