import { create } from 'zustand';
import { supabase } from '@/integrations/supabase/client';
import { withSupabaseRetry } from '@/lib/supabaseRetry';
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
  /**
   * Superuser-only role override. When set, getActiveOrg() returns this role
   * instead of the user's true membership role so superusers can preview how
   * the app looks for owners/admins/members without creating new accounts.
   * Persisted in sessionStorage so a refresh keeps the simulated role.
   */
  roleOverride: 'owner' | 'admin' | 'member' | null;
  loadMemberships: (userId: string) => Promise<void>;
  setActiveOrg: (orgId: string, orgName?: string) => void;
  createOrganization: (name: string, slug: string, userId: string) => Promise<string>;
  getActiveOrg: () => Membership | null;
  setRoleOverride: (role: 'owner' | 'admin' | 'member' | null) => void;
}

async function ensureProfileExists(userId: string): Promise<void> {
  const { data: existingProfile, error: profileError } = await withSupabaseRetry(() =>
    supabase
      .from('profiles')
      .select('id')
      .eq('id', userId)
      .maybeSingle(),
  );


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

const MEMBERSHIPS_CACHE_KEY = 'cached_memberships';
const MEMBERSHIPS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes

function readCachedMemberships(): { memberships: Membership[]; userId: string } | null {
  try {
    const raw = localStorage.getItem(MEMBERSHIPS_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (!cached?.userId || !cached?.timestamp || !Array.isArray(cached?.memberships)) return null;
    if (Date.now() - cached.timestamp > MEMBERSHIPS_CACHE_TTL_MS) return null;
    return { memberships: cached.memberships, userId: cached.userId };
  } catch {
    return null;
  }
}

function writeCachedMemberships(userId: string, memberships: Membership[]): void {
  try {
    localStorage.setItem(MEMBERSHIPS_CACHE_KEY, JSON.stringify({ userId, memberships, timestamp: Date.now() }));
  } catch {
    // Storage full or unavailable — not critical.
  }
}

export const useOrgStore = create<OrgState>()((set, get) => ({
  memberships: [],
  activeOrgId: null,
  activeOrgName: null,
  loading: true,
  roleOverride: (() => {
    const v = typeof sessionStorage !== 'undefined' ? sessionStorage.getItem('roleOverride') : null;
    return v === 'owner' || v === 'admin' || v === 'member' ? v : null;
  })(),

  setRoleOverride: (role) => {
    if (role) sessionStorage.setItem('roleOverride', role);
    else sessionStorage.removeItem('roleOverride');
    set({ roleOverride: role });
  },

  loadMemberships: async (userId: string) => {
    // Restore from cache immediately so the user never sees "Loading…" on
    // repeat visits.  The fresh RPC result replaces the cache afterwards.
    const cached = readCachedMemberships();
    if (cached && cached.userId === userId && cached.memberships.length > 0) {
      const stored = localStorage.getItem('activeOrgId');
      const activeOrgId = cached.memberships.find(m => m.organization_id === stored)
        ? stored
        : cached.memberships[0]?.organization_id ?? null;
      set({ memberships: cached.memberships, activeOrgId, loading: false });
      // Fire a background refresh so the data stays fresh.
      void (async () => {
        const { data, error } = await supabase.rpc('get_user_memberships', { _user_id: userId });
        if (error || !data) return;
        const fresh = data as Membership[];
        writeCachedMemberships(userId, fresh);
        const freshOrgId = fresh.find(m => m.organization_id === get().activeOrgId)
          ? get().activeOrgId
          : fresh[0]?.organization_id ?? null;
        set({ memberships: fresh, activeOrgId: freshOrgId });
      })();
      return;
    }

    set({ loading: true });
    // Safety timeout: if the RPC call hangs (e.g. Supabase unreachable), unblock
    // the loading screen after 10 seconds so the app doesn't stay on "Loading..."
    // indefinitely. App.tsx shows "Loading..." while orgLoading is true.
    const timeoutId = setTimeout(() => {
      if (get().loading) {
        console.warn('loadMemberships: timed out after 10 s, clearing loading state');
        set({ loading: false });
      }
    }, 10000);

    const { data, error } = await withSupabaseRetry(() =>
      supabase.rpc('get_user_memberships', { _user_id: userId }),
    );
    clearTimeout(timeoutId);


    if (error) {
      console.error('loadMemberships:', error);
      set({ loading: false });
      return;
    }
    const memberships = (data ?? []) as Membership[];
    writeCachedMemberships(userId, memberships);
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
    const { memberships, activeOrgId, roleOverride } = get();
    const m = memberships.find(m => m.organization_id === activeOrgId) ?? null;
    if (m && roleOverride) return { ...m, role: roleOverride };
    return m;
  },
}));
