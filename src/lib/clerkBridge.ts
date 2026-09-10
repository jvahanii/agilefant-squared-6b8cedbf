/**
 * Publishes the Clerk session to non-Clerk code, and maps it onto this app's
 * own user identity.
 *
 * Clerk's hooks throw when used outside ClerkProvider, and the provider is only
 * mounted when a publishable key is configured — so useAuth cannot call them
 * directly without breaking every build that has no key. ClerkBridge is
 * rendered inside the provider and pushes what it sees into a plain
 * subscribable value that anything can read.
 */
import { useEffect } from 'react';
import { useClerk, useUser } from '@clerk/clerk-react';
import { supabase } from '@/integrations/supabase/client';

/**
 * Same source of truth main.tsx uses to decide whether to mount the provider.
 * Without it there is no way to tell "Clerk is still loading" from "this build
 * has no Clerk at all", and the app would wait forever for the latter.
 */
export const clerkEnabled = Boolean(import.meta.env.VITE_CLERK_PUBLISHABLE_KEY);

export interface ClerkIdentity {
  clerkUserId: string;
  email: string | null;
  fullName: string | null;
  avatarUrl: string | null;
}

export type ClerkState =
  /** Still loading. Nobody should conclude anything about the user yet. */
  | { status: 'unknown' }
  | { status: 'signed-out' }
  | { status: 'signed-in'; identity: ClerkIdentity };

let state: ClerkState = clerkEnabled ? { status: 'unknown' } : { status: 'signed-out' };
const listeners = new Set<(s: ClerkState) => void>();

export function getClerkState(): ClerkState {
  return state;
}

export function subscribeToClerk(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function publish(next: ClerkState) {
  state = next;
  for (const listener of listeners) listener(next);
}

/**
 * Captured from inside the provider so sign-out and password changes do not
 * depend on a global. The user object is held whole rather than as a plucked
 * method: its methods read `this`, and detaching one is exactly the bug that
 * made every profile lookup fail with "reading 'rest'" of undefined.
 */
let signOutFromClerk: (() => Promise<unknown>) | null = null;
let clerkRef: { openUserProfile: () => void } | null = null;

export async function clerkSignOut(): Promise<void> {
  await signOutFromClerk?.();
}

/** Whether Clerk is the system currently holding the session. */
export function clerkHasSession(): boolean {
  return state.status === 'signed-in';
}

/**
 * Open Clerk's own account screen, where password management lives.
 *
 * Changing a password through `user.updatePassword()` from a hand-built form
 * fails with "additional verification required": Clerk treats it as a
 * sensitive operation and wants a recent authentication factor first. Driving
 * that reverification flow ourselves would mean rebuilding a chunk of Clerk,
 * so this hands over to the component that already does it -- and which also
 * covers the cases the old form never did, like an account with no password
 * at all because it signed up through Google.
 */
export function openClerkUserProfile(): void {
  clerkRef?.openUserProfile();
}

/**
 * The Clerk user id is not this app's user id: memberships, time entries and
 * all 124 RLS policies are keyed on the `profiles.id` uuid. The database maps
 * one onto the other through `profiles.clerk_id`, and current_user_id() is the
 * single place that mapping lives — asking it here means the client agrees with
 * the policies by construction instead of by duplicated logic.
 *
 * Returns null when no profile claims this Clerk subject, which is a state the
 * caller has to show rather than hide: the account exists but reaches no data.
 *
 */
export async function fetchAppUserId(): Promise<string | null> {
  const { data, error } = await supabase.rpc('current_user_id');
  if (error) throw new Error(error.message);
  return data ?? null;
}

/**
 * Claim a profile for the current Clerk session: link an existing one by
 * verified email, or create a new one.
 *
 * Kept separate from fetchAppUserId because this one writes. It runs only
 * when the read came back empty, so a returning user never touches it.
 *
 * Throws rather than returning null when the session carries no verified
 * email — that is a state the user has to be told about, not one to paper
 * over by silently creating an unreachable account.
 */
export async function linkClerkIdentity(): Promise<string | null> {
  const { data, error } = await supabase.rpc('link_clerk_identity');
  if (error) throw new Error(error.message);
  return data ?? null;
}

export function ClerkBridge() {
  const { isLoaded, user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    signOutFromClerk = () => clerk.signOut();
    clerkRef = clerk;
    return () => {
      signOutFromClerk = null;
      clerkRef = null;
    };
  }, [clerk]);

  useEffect(() => {
    if (!isLoaded) {
      publish({ status: 'unknown' });
      return;
    }
    if (!user) {
      publish({ status: 'signed-out' });
      return;
    }
    publish({
      status: 'signed-in',
      identity: {
        clerkUserId: user.id,
        email: user.primaryEmailAddress?.emailAddress ?? null,
        fullName: user.fullName ?? null,
        avatarUrl: user.imageUrl ?? null,
      },
    });
  }, [isLoaded, user]);

  return null;
}
