import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';

export interface Organization {
  id: string;
  name: string;
  slug: string;
}

export interface Membership {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  role: 'owner' | 'admin' | 'member';
}

interface OrgState {
  memberships: Membership[];
  activeOrgId: string | null;
  loading: boolean;
  loadMemberships: (userId: string) => Promise<void>;
  setActiveOrg: (orgId: string) => void;
  createOrganization: (name: string, slug: string, userId: string) => Promise<string>;
  getActiveOrg: () => Membership | null;
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  memberships: [],
  activeOrgId: null,
  loading: true,

  loadMemberships: async (userId: string) => {
    const { data, error } = await supabase.rpc('get_user_memberships', { _user_id: userId });
    if (error) {
      console.error('loadMemberships:', error);
      set({ loading: false });
      return;
    }
    const memberships = (data ?? []) as Membership[];
    const stored = localStorage.getItem('activeOrgId');
    const activeOrgId = memberships.find(m => m.organization_id === stored)
      ? stored
      : memberships[0]?.organization_id ?? null;
    set({ memberships, activeOrgId, loading: false });
  },

  setActiveOrg: (orgId: string) => {
    localStorage.setItem('activeOrgId', orgId);
    set({ activeOrgId: orgId });
  },

  createOrganization: async (name: string, slug: string, userId: string) => {
    const { data: org, error: orgError } = await supabase
      .from('organizations')
      .insert({ name, slug })
      .select('id')
      .single();
    if (orgError) throw orgError;

    const { error: memError } = await supabase
      .from('memberships')
      .insert({ user_id: userId, organization_id: org.id, role: 'owner' });
    if (memError) throw memError;

    return org.id;
  },

  getActiveOrg: () => {
    const { memberships, activeOrgId } = get();
    return memberships.find(m => m.organization_id === activeOrgId) ?? null;
  },
}));
