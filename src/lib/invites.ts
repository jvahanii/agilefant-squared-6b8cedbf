import { supabase } from "@/integrations/supabase/client";

/**
 * Invite links (2026-11-16; migration 20261116220000). An owner or admin
 * makes one in Team settings; whoever opens it (/join/<token>) and signs up
 * or in becomes a member of that organisation.
 *
 * The invite page cannot know who is signed in (it is served without Clerk),
 * so the invite is remembered in this browser until the app, signed in,
 * accepts it: Onboarding for a new account (instead of making them an
 * organisation of their own), the app's index for an existing one.
 */
export const PENDING_INVITE_KEY = "agilefant.pendingInvite";
export const PENDING_INVITE_DAYS = 7;

export interface PendingInvite {
  token: string;
  organizationName: string;
}

export const inviteUrl = (token: string, origin = typeof location === "undefined" ? "https://agilefant.org" : location.origin) =>
  `${origin}/join/${token}`;

export function rememberInvite(invite: PendingInvite, now = new Date()): void {
  try {
    localStorage.setItem(PENDING_INVITE_KEY, JSON.stringify({ ...invite, savedAt: now.toISOString() }));
  } catch {
    // Without storage the invite is lost; the page says to open the link again signed in.
  }
}

/** The invite waiting in this browser, if it is recent enough. */
export function pendingInvite(now = new Date()): PendingInvite | null {
  try {
    const raw = localStorage.getItem(PENDING_INVITE_KEY);
    if (!raw) return null;
    const { token, organizationName, savedAt } = JSON.parse(raw) as Record<string, unknown>;
    const age = now.getTime() - new Date(String(savedAt)).getTime();
    if (typeof token !== "string" || token.length < 32 || !(age >= 0 && age <= PENDING_INVITE_DAYS * 86_400_000)) {
      localStorage.removeItem(PENDING_INVITE_KEY);
      return null;
    }
    return { token, organizationName: typeof organizationName === "string" ? organizationName : "" };
  } catch {
    return null;
  }
}

export function forgetInvite(): void {
  try {
    localStorage.removeItem(PENDING_INVITE_KEY);
  } catch {
    // Nothing to do.
  }
}

const rpc = <T>(name: string, args: Record<string, unknown>) =>
  supabase.rpc(name as never, args as never) as unknown as Promise<{ data: T | null; error: { message: string } | null }>;

/** The organisation's name for a working link, or null. */
export async function lookUpInvite(token: string): Promise<string | null> {
  const { data, error } = await rpc<{ organizationName: string }>("get_invite", { _token: token });
  if (error) throw new Error(error.message);
  return data?.organizationName ?? null;
}

export interface Accepted {
  organizationId: string;
  organizationName: string;
  joined: boolean;
}

/** Accepts the waiting invite, if any, and forgets it either way. */
export async function acceptPendingInvite(): Promise<Accepted | null> {
  const invite = pendingInvite();
  if (!invite) return null;
  forgetInvite();
  const { data, error } = await rpc<Accepted>("accept_invite", { _token: invite.token });
  if (error) throw new Error(error.message);
  return data;
}

export async function getInviteLink(orgId: string): Promise<string | null> {
  const { data, error } = await rpc<string>("get_invite_link", { _organization_id: orgId });
  if (error) throw new Error(error.message);
  return data;
}

export async function createInviteLink(orgId: string): Promise<string> {
  const { data, error } = await rpc<string>("create_invite_link", { _organization_id: orgId });
  if (error || !data) throw new Error(error?.message ?? "No link came back");
  return data;
}

export async function revokeInviteLink(orgId: string): Promise<void> {
  const { error } = await rpc<null>("revoke_invite_link", { _organization_id: orgId });
  if (error) throw new Error(error.message);
}

export async function sendOnboardingFeedback(orgId: string, answer: string): Promise<void> {
  const { error } = await rpc<null>("send_onboarding_feedback", { _organization_id: orgId, _answer: answer });
  if (error) throw new Error(error.message);
}
