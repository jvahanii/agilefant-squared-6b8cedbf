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

async function ensureProfileExists(userId: string): Promise<void> {
  const { data: existingProfile, error: profileError } = await supabase
    .from('profiles')
    .select('id')
    .eq('id', userId)
    .maybeSingle();

  if (profileError) throw profileError;
  if (existingProfile) return;

  const { data: authData, error: authError } = await supabase.auth.getUser();
  if (authError) throw authError;

  const authUser = authData.user;
  if (!authUser || authUser.id !== userId) {
    throw new Error('Could not initialize your account profile. Please sign in again and retry.');
  }

  const { error: insertError } = await supabase.from('profiles').insert({
    id: authUser.id,
    email: authUser.email ?? null,
    full_name: authUser.user_metadata?.full_name ?? authUser.user_metadata?.name ?? null,
    avatar_url: authUser.user_metadata?.avatar_url ?? null,
  });

  if (insertError && insertError.code !== '23505') {
    throw insertError;
  }
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  memberships: [],
  activeOrgId: null,
  activeOrgName: null,
  loading: true,

  loadMemberships: async (userId: string) => {
    // Safety timeout: if the RPC call hangs (e.g. Supabase unreachable), unblock
    // the loading screen after 10 seconds so the app doesn't stay on "Loading..."
    // indefinitely. App.tsx shows "Loading..." while orgLoading is true.
    const timeoutId = setTimeout(() => {
      if (get().loading) {
        console.warn('loadMemberships: timed out after 10 s, clearing loading state');
        set({ loading: false });
      }
    }, 10000);

    const { data, error } = await supabase.rpc('get_user_memberships', { _user_id: userId });
    clearTimeout(timeoutId);

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

  setActiveOrg: (orgId: string, orgName?: string) => {
    localStorage.setItem('activeOrgId', orgId);
    set({ activeOrgId: orgId, activeOrgName: orgName ?? null });
  },

  createOrganization: async (name: string, slug: string, userId: string) => {
    await ensureProfileExists(userId);

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
