/**
 * Work items this page deleted a moment ago.
 *
 * A delete leaves writes behind it that were made while the item still
 * existed: saves waiting in the serial work item queue, rank retries, realtime
 * echoes of those saves arriving after the item left the screen. Any of them
 * reaching the database after the delete inserts the item again, stripped of
 * everything the delete cascaded away. On 2026-09-16 one did, 73 seconds late.
 *
 * So a deleted id is remembered: writes skip it and realtime does not put it
 * back on screen. It is forgotten when an undo restores the item, or a minute
 * after the delete reached the database — long enough for every straggler, and
 * short enough that an item restored by someone else is editable here again.
 *
 * Its own module, rather than part of supabaseSync, so that the tests mocking
 * the sync layer still share one registry with the store.
 */

export const RECENT_DELETE_GUARD_MS = 60_000;

/** id -> when its delete settled, or null while the delete is still pending. */
const deleted = new Map<string, number | null>();

export function markWorkItemsDeleted(ids: string[]): void {
  for (const id of ids) deleted.set(id, null);
}

/** Start the guard's clock, unless the id was restored (or deleted again) meanwhile. */
export function markWorkItemDeletesSettled(ids: string[]): void {
  const now = Date.now();
  for (const id of ids) if (deleted.get(id) === null) deleted.set(id, now);
}

export function forgetDeletedWorkItems(ids: string[]): void {
  for (const id of ids) deleted.delete(id);
}

export function isRecentlyDeletedWorkItem(id: string): boolean {
  const settledAt = deleted.get(id);
  if (settledAt === undefined) return false;
  if (settledAt === null) return true;
  if (Date.now() - settledAt <= RECENT_DELETE_GUARD_MS) return true;
  deleted.delete(id);
  return false;
}
