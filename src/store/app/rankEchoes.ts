import type { WorkItemBacklogRankUpsert, WorkItemBoardRankUpsert } from "../supabaseSync";

/**
 * Suppress realtime echoes of locally-written ranks for this many ms so
 * rapid keyboard reordering doesn't cause bounce-back behavior when the
 * Supabase replication channel delivers our own writes back to us.
 */
const RANK_ECHO_SUPPRESS_MS = 800;
const recentlyWrittenRanks = new Map<string, number>(); // "wiId::blId" → timestamp
const recentlyWrittenBoardRanks = new Map<string, number>();

export function suppressLocalRankEcho(workItemId: string, backlogId: string): boolean {
  const key = `${workItemId}::${backlogId}`;
  const ts = recentlyWrittenRanks.get(key);
  return ts !== undefined && (Date.now() - ts < RANK_ECHO_SUPPRESS_MS);
}

export function suppressLocalBoardRankEcho(workItemId: string, backlogId: string): boolean {
  const key = `${workItemId}::${backlogId}`;
  const ts = recentlyWrittenBoardRanks.get(key);
  return ts !== undefined && (Date.now() - ts < RANK_ECHO_SUPPRESS_MS);
}

/**
 * Clears the rank-echo suppression windows.  Test-only: the maps above are
 * module-level (per page-load in the app), so without this reset a locally
 * written rank in one test suppresses realtime rank events in the next one.
 */
export function resetRankEchoSuppression() {
  recentlyWrittenRanks.clear();
  recentlyWrittenBoardRanks.clear();
}

export function recordRankWrite(rows: WorkItemBacklogRankUpsert[]) {
  const now = Date.now();
  for (const r of rows) recentlyWrittenRanks.set(`${r.workItemId}::${r.backlogId}`, now);
  // Lazy cleanup of expired entries
  for (const [k, ts] of recentlyWrittenRanks) {
    if (now - ts > RANK_ECHO_SUPPRESS_MS) recentlyWrittenRanks.delete(k);
  }
}

export function recordBoardRankWrite(rows: WorkItemBoardRankUpsert[]) {
  const now = Date.now();
  for (const r of rows) recentlyWrittenBoardRanks.set(`${r.workItemId}::${r.backlogId}`, now);
  for (const [k, ts] of recentlyWrittenBoardRanks) {
    if (now - ts > RANK_ECHO_SUPPRESS_MS) recentlyWrittenBoardRanks.delete(k);
  }
}
