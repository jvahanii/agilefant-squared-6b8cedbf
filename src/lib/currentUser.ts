/**
 * Who is signed in, independent of which auth system is providing it.
 *
 * Exists because of a hard constraint in supabase-js: passing the `accessToken`
 * option to createClient (which is how a third-party provider like Clerk is
 * wired in) replaces `supabase.auth` with a proxy that throws on *any* property
 * access. So the moment Clerk is connected, every `supabase.auth.getUser()` in
 * the app starts throwing. Routing those call sites through here first lets that
 * switch happen in one small place rather than in nine files at once.
 *
 * The id is always the `profiles.id` uuid, never the Clerk user id. Everything
 * downstream — memberships, snoozes, time entries, and all 124 RLS policies —
 * is keyed on that uuid, and the database maps a Clerk subject onto it via
 * `profiles.clerk_id`. Handing a Clerk id to any of that would silently match
 * nothing.
 */
import { supabaseAuth } from '@/integrations/supabase/authClient';

export interface CurrentUser {
  /** profiles.id — the uuid identity used everywhere in this app. */
  id: string;
  email: string | null;
  /** Used when seeding a profiles row; both auth systems can supply them. */
  fullName: string | null;
  avatarUrl: string | null;
}

let cached: CurrentUser | null = null;

/**
 * Publish the signed-in user. Called by the auth provider on sign-in, sign-out
 * and token refresh, so the stores don't each have to ask the auth system.
 */
export function setCurrentUser(user: CurrentUser | null): void {
  cached = user;
}

export function peekCurrentUser(): CurrentUser | null {
  return cached;
}

export async function getCurrentUser(): Promise<CurrentUser | null> {
  if (cached) return cached;

  // Fallback for as long as Supabase Auth is still a way in. It has to ask
  // supabaseAuth rather than the main client: the main client is configured
  // with `accessToken`, so its `.auth` throws on every access.
  try {
    const { data } = await supabaseAuth.auth.getUser();
    if (!data.user) return null;
    const meta = data.user.user_metadata ?? {};
    return {
      id: data.user.id,
      email: data.user.email ?? null,
      fullName: (meta.full_name as string | undefined) ?? (meta.name as string | undefined) ?? null,
      avatarUrl: (meta.avatar_url as string | undefined) ?? null,
    };
  } catch {
    return null;
  }
}

export async function getCurrentUserId(): Promise<string | null> {
  return (await getCurrentUser())?.id ?? null;
}
