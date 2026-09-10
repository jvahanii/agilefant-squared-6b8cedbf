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

/** Captured from inside the provider so sign-out doesn't depend on a global. */
let signOutFromClerk: (() => Promise<unknown>) | null = null;

export async function clerkSignOut(): Promise<void> {
  await signOutFromClerk?.();
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
 * The cast is because current_user_id() is absent from the generated
 * Database types, and types.ts is regenerated from outside this repo — an entry
 * added there would be silently dropped, so the typing lives here instead.
 */
export async function fetchAppUserId(): Promise<string | null> {
  const rpc = supabase.rpc as unknown as (
    fn: string,
  ) => Promise<{ data: string | null; error: { message: string } | null }>;
  const { data, error } = await rpc('current_user_id');
  if (error) throw new Error(error.message);
  return data ?? null;
}

export function ClerkBridge() {
  const { isLoaded, user } = useUser();
  const clerk = useClerk();

  useEffect(() => {
    signOutFromClerk = () => clerk.signOut();
    return () => {
      signOutFromClerk = null;
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
