import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { resetOrgData } from './supabaseSync';
import { mockData as staticMockData } from './mockData';

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
  activeOrgName: string | null;
  loading: boolean;
  loadMemberships: (userId: string) => Promise<void>;
  setActiveOrg: (orgId: string, orgName?: string) => void;
  createOrganization: (name: string, slug: string, userId: string) => Promise<string>;
  getActiveOrg: () => Membership | null;
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  memberships: [],
  activeOrgId: null,
  activeOrgName: null,
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
    const resolvedMembership = memberships.find(m => m.organization_id === stored);
    const activeOrgId = resolvedMembership
      ? stored
      : memberships[0]?.organization_id ?? null;
    const activeOrgName = (resolvedMembership ?? memberships[0])?.organization_name ?? null;
    set({ memberships, activeOrgId, activeOrgName, loading: false });
  },

  setActiveOrg: (orgId: string, orgName?: string) => {
    localStorage.setItem('activeOrgId', orgId);
    const { memberships } = get();
    const membership = memberships.find(m => m.organization_id === orgId);
    set({ activeOrgId: orgId, activeOrgName: orgName ?? membership?.organization_name ?? null });
  },

  createOrganization: async (name: string, slug: string, userId: string) => {
    const { data, error } = await supabase.rpc('create_organization_with_owner', {
      _name: name,
      _slug: slug,
      _user_id: userId,
    });
    if (error) throw error;
    const orgId = data as string;
    await resetOrgData(orgId, structuredClone(staticMockData) as any);
    return orgId;
  },

  getActiveOrg: () => {
    const { memberships, activeOrgId } = get();
    return memberships.find(m => m.organization_id === activeOrgId) ?? null;
  },
}));
