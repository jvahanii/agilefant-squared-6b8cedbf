import { create } from "zustand";
import { supabase } from "@/integrations/supabase/client";

/**
 * Copies of public lists (2026-11-16; migration 20261116150000): a visitor
 * to a public list of job ads can have it in their own account, and the copy
 * keeps receiving the list's new ads without ever losing the ones it has.
 *
 * The public page cannot know who is signed in (it is served without Clerk),
 * so the copy is asked for there and made in the app: the link is remembered
 * in this browser until the app, signed in, picks it up.
 */
export const PENDING_COPY_KEY = "agilefant.pendingListCopy";
/** A request older than this is dropped: the visitor has moved on. */
export const PENDING_COPY_HOURS = 24;
const SYNC_KEY = (orgId: string) => `agilefant.listCopiesSynced.${orgId}`;
/** How often one browser asks for new items for an organisation's copies. */
export const SYNC_EVERY_MS = 60 * 60 * 1000;

export interface CopyResult {
  treeId: string;
  backlogId: string;
  added: number;
  existing: boolean;
  /** More items to add: the database adds them in batches (migration 20261117090000). */
  more?: boolean;
}

/** The database's word for a list copied into the organisation it comes from. */
export const ALREADY_HERE = "This list is already in this organisation";

/** Most batches one round of filling asks for: 30 x 150 items. */
export const MAX_BATCHES = 30;

export function rememberListToCopy(token: string, now = new Date()): void {
  try {
    localStorage.setItem(PENDING_COPY_KEY, JSON.stringify({ token, savedAt: now.toISOString() }));
  } catch {
    // Without storage the copy is not made; the page says to try again signed in.
  }
}

function readListToCopy(remove: boolean, now: Date): string | null {
  try {
    const raw = localStorage.getItem(PENDING_COPY_KEY);
    if (remove) localStorage.removeItem(PENDING_COPY_KEY);
    if (!raw) return null;
    const { token, savedAt } = JSON.parse(raw) as { token?: unknown; savedAt?: unknown };
    const age = now.getTime() - new Date(String(savedAt)).getTime();
    if (typeof token !== "string" || token.length < 20 || !(age >= 0 && age <= PENDING_COPY_HOURS * 3_600_000)) return null;
    return token;
  } catch {
    return null;
  }
}

/** The link to copy, taken out of storage so it is copied once. */
export function takeListToCopy(now = new Date()): string | null {
  return readListToCopy(true, now);
}

/** Whether a copy is waiting to be made, leaving the request in storage. */
export function hasListToCopy(now = new Date()): boolean {
  return readListToCopy(false, now) !== null;
}

/**
 * True from taking the request until the copied list is open. A new account
 * would otherwise meet "Add your first item" and "Who is it for?" while its
 * copy is being made (2026-11-24): it came for the list, so it waits for that.
 */
export const useListCopyStore = create<{ copying: boolean }>(() => ({ copying: false }));

export async function copyPublishedList(token: string, orgId: string): Promise<CopyResult> {
  const { data, error } = await supabase.rpc("copy_published_list" as never, { _token: token, _organization_id: orgId } as never);
  if (error) throw new Error(error.message);
  return data as unknown as CopyResult;
}

/** Whether this browser should ask for new items now, and if so notes that it has. */
export function claimSync(orgId: string, now = Date.now()): boolean {
  try {
    const last = Number(localStorage.getItem(SYNC_KEY(orgId)) ?? 0);
    if (Number.isFinite(last) && now - last < SYNC_EVERY_MS && now >= last) return false;
    localStorage.setItem(SYNC_KEY(orgId), String(now));
    return true;
  } catch {
    return false;
  }
}

/** Adds a batch of new items to every list copied into the organisation; how many came. */
export async function syncPublishedListCopies(orgId: string): Promise<number> {
  const { data, error } = await supabase.rpc("sync_published_list_copies" as never, { _organization_id: orgId } as never);
  if (error) throw new Error(error.message);
  return typeof data === "number" ? data : 0;
}

/**
 * Batch after batch until no more items come: each call stays well within
 * the database's limit for one request (8 s), which a whole list in one
 * call did not.
 */
export async function fillCopies(orgId: string): Promise<number> {
  let total = 0;
  for (let i = 0; i < MAX_BATCHES; i++) {
    const added = await syncPublishedListCopies(orgId);
    if (added === 0) break;
    total += added;
  }
  return total;
}
