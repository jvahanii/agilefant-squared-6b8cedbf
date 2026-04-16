import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { toast } from '@/hooks/use-toast';

export interface Team {
  id: string;
  name: string;
  organization_id: string;
}

export interface TeamMember {
  id: string;
  team_id: string;
  user_id: string;
}

interface TeamState {
  teams: Team[];
  teamMembers: TeamMember[];
  /** Maps work_item_id -> team_id[] */
  workItemTeams: Record<string, string[]>;
  loading: boolean;

  loadTeams: (orgId: string) => Promise<void>;
  loadWorkItemTeams: (orgId: string) => Promise<void>;
  createTeam: (name: string, orgId: string) => Promise<void>;
  renameTeam: (teamId: string, name: string) => Promise<void>;
  deleteTeam: (teamId: string) => Promise<void>;
  addTeamMember: (teamId: string, userId: string) => Promise<void>;
  removeTeamMember: (teamId: string, userId: string) => Promise<void>;
  assignTeamToWorkItem: (workItemId: string, teamId: string, orgId: string) => Promise<void>;
  unassignTeamFromWorkItem: (workItemId: string, teamId: string) => Promise<void>;
  getTeamsForWorkItem: (workItemId: string) => string[];
  applyRealtimeTeamAssignment: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
  applyRealtimeTeam: (eventType: 'INSERT' | 'UPDATE' | 'DELETE', row: Record<string, unknown>) => void;
}

export const useTeamStore = create<TeamState>()((set, get) => ({
  teams: [],
  teamMembers: [],
  workItemTeams: {},
  loading: false,

  loadTeams: async (orgId: string) => {
    set({ loading: true });
    // Find partner org IDs via shared trees (both directions)
    const [ownedShares, receivedShares] = await Promise.all([
      supabase.from('backlog_tree_shares' as any).select('organization_id, tree_id'),
      supabase.from('backlog_tree_shares' as any).select('organization_id, tree_id'),
    ]);
    // Trees owned by orgId that are shared → partner is the share's organization_id
    // Trees shared WITH orgId → partner is the tree's owner org
    const partnerOrgIds = new Set<string>();
    // Get trees owned by orgId
    const ownedTreesRes = await supabase
      .from('backlog_trees' as any)
      .select('id, organization_id')
      .eq('organization_id', orgId);
    const ownedTreeIds = new Set(((ownedTreesRes.data ?? []) as any[]).map((t: any) => t.id));
    for (const share of ((ownedShares.data ?? []) as any[])) {
      if (ownedTreeIds.has(share.tree_id) && share.organization_id !== orgId) {
        partnerOrgIds.add(share.organization_id);
      }
    }
    // Shares where orgId is the recipient → tree owner is the partner
    for (const share of ((receivedShares.data ?? []) as any[])) {
      if (share.organization_id === orgId) {
        // Find the tree's owner org
        const tree = ((ownedTreesRes.data ?? []) as any[]).find((t: any) => t.id === share.tree_id);
        if (!tree) {
          // Tree not owned by us, fetch its org
          const { data } = await supabase
            .from('backlog_trees' as any)
            .select('organization_id')
            .eq('id', share.tree_id)
            .single();
          if (data && (data as any).organization_id !== orgId) {
            partnerOrgIds.add((data as any).organization_id);
          }
        }
      }
    }
    const allOrgIds = [orgId, ...Array.from(partnerOrgIds)];
    const [teamsRes, membersRes] = await Promise.all([
      supabase.from('teams' as any).select('*').in('organization_id', allOrgIds),
      supabase.from('team_members' as any).select('*'),
    ]);
    const teams = ((teamsRes.data ?? []) as any[]).map((t: any) => ({
      id: t.id,
      name: t.name,
      organization_id: t.organization_id,
    }));
    const teamIds = new Set(teams.map(t => t.id));
    const teamMembers = ((membersRes.data ?? []) as any[])
      .filter((m: any) => teamIds.has(m.team_id))
      .map((m: any) => ({
        id: m.id,
        team_id: m.team_id,
        user_id: m.user_id,
      }));
    set({ teams, teamMembers, loading: false });
  },

  loadWorkItemTeams: async (_orgId: string) => {
    // RLS handles visibility; don't filter by org so shared items' assignments are included
    const { data } = await supabase
      .from('work_item_team_assignments' as any)
      .select('work_item_id, team_id');
    const map: Record<string, string[]> = {};
    for (const row of (data ?? []) as any[]) {
      const wid = row.work_item_id as string;
      if (!map[wid]) map[wid] = [];
      map[wid].push(row.team_id as string);
    }
    set({ workItemTeams: map });
  },

  createTeam: async (name: string, orgId: string) => {
    const { error } = await supabase.from('teams' as any).insert({ name, organization_id: orgId });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    await get().loadTeams(orgId);
  },

  renameTeam: async (teamId: string, name: string) => {
    const { error } = await supabase.from('teams' as any).update({ name }).eq('id', teamId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    set(s => ({ teams: s.teams.map(t => t.id === teamId ? { ...t, name } : t) }));
  },

  deleteTeam: async (teamId: string) => {
    const { error } = await supabase.from('teams' as any).delete().eq('id', teamId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    set(s => ({
      teams: s.teams.filter(t => t.id !== teamId),
      teamMembers: s.teamMembers.filter(m => m.team_id !== teamId),
      workItemTeams: Object.fromEntries(
        Object.entries(s.workItemTeams).map(([wid, tids]) => [wid, tids.filter(id => id !== teamId)])
      ),
    }));
  },

  addTeamMember: async (teamId: string, userId: string) => {
    const { error } = await supabase.from('team_members' as any).insert({ team_id: teamId, user_id: userId });
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    set(s => ({
      teamMembers: [...s.teamMembers, { id: crypto.randomUUID(), team_id: teamId, user_id: userId }],
    }));
  },

  removeTeamMember: async (teamId: string, userId: string) => {
    const { error } = await supabase
      .from('team_members' as any)
      .delete()
      .eq('team_id', teamId)
      .eq('user_id', userId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    set(s => ({
      teamMembers: s.teamMembers.filter(m => !(m.team_id === teamId && m.user_id === userId)),
    }));
  },

  assignTeamToWorkItem: async (workItemId: string, teamId: string, orgId: string) => {
    const { error } = await supabase
      .from('work_item_team_assignments' as any)
      .insert({ work_item_id: workItemId, team_id: teamId, organization_id: orgId });
    if (error) {
      if (error.code === '23505') return; // duplicate
      toast({ title: 'Error', description: error.message, variant: 'destructive' });
      return;
    }
    set(s => ({
      workItemTeams: {
        ...s.workItemTeams,
        [workItemId]: [...(s.workItemTeams[workItemId] ?? []), teamId],
      },
    }));
  },

  unassignTeamFromWorkItem: async (workItemId: string, teamId: string) => {
    const { error } = await supabase
      .from('work_item_team_assignments' as any)
      .delete()
      .eq('work_item_id', workItemId)
      .eq('team_id', teamId);
    if (error) { toast({ title: 'Error', description: error.message, variant: 'destructive' }); return; }
    set(s => ({
      workItemTeams: {
        ...s.workItemTeams,
        [workItemId]: (s.workItemTeams[workItemId] ?? []).filter(id => id !== teamId),
      },
    }));
  },

  getTeamsForWorkItem: (workItemId: string) => get().workItemTeams[workItemId] ?? [],
}));
