/**
 * What loading and saving share: the rows' shapes, whose an id is, the retries
 * for a session renewal, a deadlock or a statement timeout, and the repair of
 * ids carrying a stale organization prefix. Taken out of supabaseSync.ts word
 * for word.
 */
import { supabase } from '@/integrations/supabase/client';

/** Ensure rank is a finite integer – guards against NaN / undefined / null leaking to the DB. */
export const safeRank = (r: unknown): number => (typeof r === 'number' && Number.isFinite(r) ? r : 0);

// Work-item creates/reorders often touch many sibling ranks. Keep those DB
// mutations in call order so fast consecutive adds cannot persist stale ranks
// after newer ones and reshuffle the list on the next refresh.
export let workItemMutationQueue: Promise<void> = Promise.resolve();

export function enqueueWorkItemMutation<T>(operation: () => Promise<T>): Promise<T> {
  const run = workItemMutationQueue.catch(() => undefined).then(operation);
  workItemMutationQueue = run.then(() => undefined, () => undefined);
  return run;
}

export type WorkItemUpsertRow = {
  id: string;
  title: string;
  description: string | null;
  points: number | null;
  rating: number | null;
  /** yyyy-mm-dd, or null for none. */
  deadline: string | null;
  /**
   * yyyy-mm-dd. Named only where the item has one, and never as null: a row
   * that leaves it out keeps what the database holds on an update, and takes
   * the column's default — today — on an insert. Sending null instead would
   * let a tab still holding items from before the column existed wipe the
   * dates the migration filled in.
   */
  created_on?: string;
  /** yyyy-mm-dd, or null for none — sent either way, as a deadline is. */
  started_on: string | null;
  ended_on: string | null;
  status: string;
  parent_id: string | null;
  parent_id_overrides?: Record<string, string | null>;
  backlog_assignments: Record<string, string>;
  rank: number;
  organization_id: string;
  respawn_enabled: boolean;
  respawn_interval_days: number | null;
  respawn_hour: number | null;
  respawn_minute: number | null;
  respawn_last_triggered_at: string | null;
};

export type WorkItemBacklogRankUpsert = {
  workItemId: string;
  backlogId: string;
  rank: number;
  organizationId: string;
};

export type WorkItemBoardRankUpsert = WorkItemBacklogRankUpsert;

/**
 * Return the organization that owns an entity, derived from its ID prefix
 * (format: "<orgId>::<rawId>").  Falls back to `defaultOrgId` for unprefixed
 * legacy/mock IDs so that newly-created entities are always attributed to the
 * active org.
 *
 * `sep > 0` (not `>= 0`) is intentional: an ID starting with '::' has an
 * empty org prefix and is treated as unprefixed, falling back to defaultOrgId.
 */
export function ownerOrgOf(entityId: string, defaultOrgId: string): string {
  const sep = entityId.indexOf('::');
  return sep > 0 ? entityId.slice(0, sep) : defaultOrgId;
}

/**
 * Returns true when an item's ID prefix embeds a different org than the item's
 * actual `organization_id`.  This happens when items were transferred to a new
 * org but their ID string was not yet renamed.
 */
export function isStalePrefix(id: string, effectiveOrgId: string): boolean {
  const sep = id.indexOf('::');
  return sep > 0 && id.slice(0, sep) !== effectiveOrgId;
}

export type SupabaseReadResult<T = any> = { data: T[] | null; error: any };

// The rank tables also carry id/organization_id/created_at, none of which are
// read here. Selecting the whole row roughly doubles the cold-start payload
// for these two tables, which are the largest by row count.
export const RANK_COLUMNS = 'work_item_id,backlog_id,rank';

export const HYPERLINK_COLUMNS = 'id,work_item_id,url,alt_text,rank';

export type PageResult = { data: any[] | null; error: any; count?: number | null };

/**
 * Callback invoked after a batch of work-item IDs has been renamed in the DB
 * so that callers (e.g. the Zustand store) can update their local state.
 * Maps old ID → new ID.
 */
export type WorkItemRenameCallback = (oldToNew: Record<string, string>) => void;

export let renameCallback: WorkItemRenameCallback | null = null;

/** Register a store-level callback to be notified when work-item IDs are renamed. */
export function registerWorkItemRenameCallback(cb: WorkItemRenameCallback): void {
  renameCallback = cb;
}

/**
 * Calls the `rename_work_items_org_prefix` RPC for items whose ID prefix does
 * not match their effective `organization_id`, then notifies the registered
 * callback so the local store can update its references.
 *
 * Returns a map of old ID → new ID for all items that were renamed.
 */
export async function repairStaleOrgPrefixes(
  items: Array<{ id: string; organizationId?: string }>,
  activeOrgId: string,
): Promise<Record<string, string>> {
  // Filter items whose ID prefix doesn't match their actual org.
  const stale = items.filter(item => {
    const effectiveOrg = item.organizationId ?? activeOrgId;
    return isStalePrefix(item.id, effectiveOrg);
  });
  if (stale.length === 0) return {};

  // Group by effective org (should normally all be the same org after transfer).
  const byOrg = new Map<string, string[]>();
  for (const item of stale) {
    const orgId = item.organizationId ?? activeOrgId;
    if (!byOrg.has(orgId)) byOrg.set(orgId, []);
    byOrg.get(orgId)!.push(item.id);
  }

  const oldToNew: Record<string, string> = {};
  for (const [orgId, ids] of byOrg) {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { data, error } = await (supabase as any).rpc('rename_work_items_org_prefix', {
      _item_ids: ids,
      _new_org_id: orgId,
    });
    if (error) {
      console.error('repairStaleOrgPrefixes RPC failed:', error);
      continue;
    }
    Object.assign(oldToNew, data as Record<string, string>);
  }

  if (Object.keys(oldToNew).length > 0) {
    renameCallback?.(oldToNew);
  }
  return oldToNew;
}

/**
 * Refresh the Supabase auth session and retry a DB operation once on auth errors.
 *
 * Exported for the test that pins the retry to happening even when the refresh
 * fails, which is always the case for a Clerk session.
 */
export async function withSessionRetry(
  operation: () => PromiseLike<{ error: { message?: string; code?: string } | null }>
): Promise<{ error: { message?: string; code?: string } | null }> {
  const result = await operation();
  if (!result.error) return result;

  // Only attempt a refresh + retry for auth-related errors (expired/invalid JWT, RLS violation).
  const { code, message } = result.error;
  const isAuthError =
    (code && (code.startsWith('PGRST') || code === '42501')) ||
    (message && (message.includes('JWT') || message.includes('not authenticated')));
  if (!isAuthError) return result;

  // Retrying is the whole recovery: the data client asks for a token on every
  // request and Clerk hands back a fresh one, so a second attempt carries a
  // valid token even when the first did not.
  return operation();
}

/** How long a write that lost a deadlock waits before its first new attempt. */
export const DEADLOCK_RETRY_MS = 150;

export function isDeadlock(error: { message?: string; code?: string } | null): boolean {
  return !!error && (error.code === '40P01' || /deadlock detected/i.test(error.message ?? ''));
}

/**
 * Run a write again when the database stopped it to break a deadlock.
 *
 * Moving items between lists sends two writes at once: the items themselves,
 * and their ranks in the list they land in. Each rank row has to look at the
 * item it belongs to while the other write is changing that item, and when two
 * items are involved the two writes can each end up holding one and waiting
 * for the other. Postgres notices, lets one through, and refuses the other
 * with "deadlock detected" — which used to be shown as a failure to save.
 *
 * Nothing of the refused write has been done, and by the time it is told so
 * the other has finished: sending it again is the whole remedy, and what the
 * database expects. A few times, a little further apart each time and not in
 * step with anyone else doing the same.
 */
export async function withDeadlockRetry<T extends { error: { message?: string; code?: string } | null }>(
  operation: () => PromiseLike<T>,
  attempts = 4,
): Promise<T> {
  let result = await operation();
  for (let attempt = 1; attempt < attempts && isDeadlock(result.error); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, DEADLOCK_RETRY_MS * attempt + Math.random() * DEADLOCK_RETRY_MS));
    result = await operation();
  }
  return result;
}

/**
 * How many rank rows go in one write.
 *
 * Re-ordering a list rewrites the rank of every item in it, and the "Open jobs"
 * list holds over a thousand. Sent as one statement, that write usually takes
 * a fraction of a second — and while the database is busy, as it is straight
 * after an import, it ran past the eight seconds a signed-in request is allowed
 * and came back "canceling statement due to statement timeout". In batches of
 * this size each statement stays far inside the limit however busy it gets.
 */
export const RANK_WRITE_CHUNK = 200;

/**
 * How long to wait before each further try of a write the database stopped for
 * taking too long. The database can stall for minutes at a time — every
 * statement slow, not this one — and a single small save then runs out of its
 * eight seconds through no fault of its own. Nothing of a stopped write has been
 * done, so sending it again is safe, and saves queue, so they stay in order.
 */
export const STALL_RETRY_DELAYS_MS = [1_500, 5_000, 15_000];

export function isStatementTimeout(error: { message?: string; code?: string } | null): boolean {
  return !!error && (error.code === '57014' || /statement timeout/i.test(error.message ?? ''));
}

/** A write, tried again while the database keeps stopping it for taking too long. */
export async function withStallRetry<T extends { error: { message?: string; code?: string } | null }>(
  send: () => PromiseLike<T>,
): Promise<T> {
  let result = await send();
  for (const delay of STALL_RETRY_DELAYS_MS) {
    if (!isStatementTimeout(result.error)) break;
    await new Promise((resolve) => setTimeout(resolve, delay));
    result = await send();
  }
  return result;
}
