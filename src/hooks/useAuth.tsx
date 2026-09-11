import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, ReactNode } from 'react';
import { useAppStore } from '@/store/appStore';
import { useOrgStore } from '@/store/orgStore';
import { useTeamStore } from '@/store/teamStore';
import { useTimeEntryStore } from '@/store/timeEntryStore';
import { useSnoozeStore } from '@/store/snoozeStore';
import { setCurrentUser } from "@/lib/currentUser";
import {
  clerkSignOut,
  fetchAppUserId,
  getClerkState,
  linkClerkIdentity,
  subscribeToClerk,
} from "@/lib/clerkBridge";
import { usePublishedLinksStore } from '@/store/publishedLinksStore';

/**
 * The shape consumers read. It kept `user_metadata` when Clerk replaced Supabase
 * Auth so that the thirteen files reading `user.user_metadata?.full_name` did
 * not all have to change at once; that is still the only reason it is nested.
 */
export interface AuthUser {
  /** profiles.id — never a Clerk user id. See lib/currentUser.ts. */
  id: string;
  email?: string | null;
  /** Named fields are the ones this app reads. */
  user_metadata?: {
    full_name?: string;
    name?: string;
    avatar_url?: string;
    [key: string]: unknown;
  };
}

/** Clerk has a session, but no profile could be linked to it. */
export interface UnlinkedClerkAccount {
  clerkUserId: string;
  email: string | null;
  /** Why the link failed — almost always an unverified email address. */
  error: string | null;
}

interface AuthContextType {
  user: AuthUser | null;
  loading: boolean;
  signOut: () => Promise<void>;
  unlinkedClerk: UnlinkedClerkAccount | null;
}

const AuthContext = createContext<AuthContextType>({
  user: null,
  loading: true,
  signOut: async () => {},
  unlinkedClerk: null,
});

function resetClientStoresAfterSignOut() {
  useOrgStore.setState({ memberships: [], activeOrgId: null, activeOrgName: null, loading: false });
  useAppStore.setState({
    workItems: {},
    backlogs: {},
    backlogTrees: {},
    hyperlinks: {},
    selectedBacklogIds: [],
    selectedTreeId: null,
    selectedWorkItemIds: [],
    changeLog: [],
    expandedWorkItems: new Set(),
    expandedBacklogs: new Set(),
    undoStack: [],
    redoStack: [],
    isLoading: false,
    loadingProgress: 0,
    organizationId: null,
    userId: null,
    userEmail: null,
  });
  useTeamStore.setState({ teams: [], teamMembers: [], workItemTeams: {}, loading: false });
  useTimeEntryStore.setState({ timeEntries: {}, isLoading: false });
  useSnoozeStore.setState({ snoozes: {}, isLoading: false });
  usePublishedLinksStore.setState({ trees: new Set(), backlogs: new Set() });
}

/** A resolved (or failed) Clerk-subject to profiles.id lookup. */
interface ClerkMapping {
  clerkUserId: string;
  appUserId: string | null;
  error: string | null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const clerk = useSyncExternalStore(subscribeToClerk, getClerkState);
  const clerkUserId = clerk.status === 'signed-in' ? clerk.identity.clerkUserId : null;
  const [mapping, setMapping] = useState<ClerkMapping | null>(null);
  const [clerkTimedOut, setClerkTimedOut] = useState(false);

  // If Clerk's script never finishes loading the app would otherwise sit on
  // "Loading..." forever rather than falling through to the sign-in page.
  useEffect(() => {
    if (clerk.status !== 'unknown') return;
    const timeout = setTimeout(() => setClerkTimedOut(true), 8000);
    return () => clearTimeout(timeout);
  }, [clerk.status]);

  // Translate the Clerk subject into this app's profiles.id.
  useEffect(() => {
    if (!clerkUserId) {
      setMapping(null);
      return;
    }
    let cancelled = false;
    // Without this the app would spin on "Loading..." indefinitely if the
    // lookup never comes back. Reporting it as a failed link at least leaves
    // the sign-out button reachable.
    const timeout = setTimeout(() => {
      if (!cancelled) {
        setMapping({ clerkUserId, appUserId: null, error: 'the profile lookup timed out' });
      }
    }, 8000);
    // A first-time Clerk account has no profile yet, so the read comes back
    // empty and link_clerk_identity() is what creates or claims one. Only
    // after that has been tried is an empty result really "not linked".
    fetchAppUserId()
      .then((appUserId) => appUserId ?? linkClerkIdentity())
      .then((appUserId) => {
        clearTimeout(timeout);
        if (!cancelled) setMapping({ clerkUserId, appUserId, error: null });
      })
      .catch((err: unknown) => {
        clearTimeout(timeout);
        if (cancelled) return;
        const message = err instanceof Error ? err.message : String(err);
        console.error('Could not map the Clerk session onto a profile:', message);
        setMapping({ clerkUserId, appUserId: null, error: message });
      });
    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [clerkUserId]);

  // Only a mapping belonging to the Clerk user currently signed in counts; a
  // stale one would hand the previous user's data to the next one.
  const currentMapping = mapping && mapping.clerkUserId === clerkUserId ? mapping : null;
  const clerkIdentity = clerk.status === 'signed-in' ? clerk.identity : null;
  const appUserId = currentMapping?.appUserId ?? null;

  const user = useMemo<AuthUser | null>(() => {
    if (!clerkIdentity || !appUserId) return null;
    return {
      id: appUserId,
      email: clerkIdentity.email,
      user_metadata: {
        full_name: clerkIdentity.fullName ?? undefined,
        avatar_url: clerkIdentity.avatarUrl ?? undefined,
      },
    };
    // Keyed on the values rather than the identity object, so a Clerk
    // re-render doesn't hand every consumer a new user and re-run their effects.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [appUserId, clerkIdentity?.email, clerkIdentity?.fullName, clerkIdentity?.avatarUrl]);

  const unlinkedClerk = useMemo<UnlinkedClerkAccount | null>(() => {
    if (!clerkIdentity || !currentMapping || currentMapping.appUserId) return null;
    return {
      clerkUserId: currentMapping.clerkUserId,
      email: clerkIdentity.email,
      error: currentMapping.error,
    };
    // Same reasoning: the identity object itself is deliberately not a
    // dependency, only the email it carries.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clerkIdentity?.email, currentMapping]);

  // Two things have to settle before the app may conclude "nobody is signed
  // in" and redirect: Clerk deciding whether it has a session, and the profile
  // lookup for that session. Both are derived rather than stored, so there is
  // no render in between where loading briefly reads false.
  const clerkDeciding = clerk.status === 'unknown' && !clerkTimedOut;
  const clerkMappingPending = clerkUserId !== null && currentMapping === null;
  const loading = clerkDeciding || clerkMappingPending;


  const signOut = async () => {
    await clerkSignOut();
    setMapping(null);
    // Clerk fires no event the stores listen for, so they are cleared here.
    resetClientStoresAfterSignOut();
  };

  // Mirror the signed-in user into the auth-agnostic helper the stores read.
  // Kept as one effect rather than added to each call site so it cannot drift
  // out of sync with the React state it is meant to reflect.
  useEffect(() => {
    setCurrentUser(
      user
        ? {
            id: user.id,
            email: user.email ?? null,
            fullName:
              user.user_metadata?.full_name ?? user.user_metadata?.name ?? null,
            avatarUrl: user.user_metadata?.avatar_url ?? null,
          }
        : null,
    );
  }, [user]);

  return (
    <AuthContext.Provider value={{ user, loading, signOut, unlinkedClerk }}>
      {children}
    </AuthContext.Provider>
  );
}

export const useAuth = () => useContext(AuthContext);
