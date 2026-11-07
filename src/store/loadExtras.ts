/**
 * A load's small reads, in one request (get_load_extras, 20261107100000).
 *
 * After the items, a load read some twenty small tables — labels, settings,
 * teams, statuses, snoozes and the rest — each its own request, from its own
 * store. On a database that answers a burst slowly each waited its turn, three
 * to four seconds apiece. Now the load asks for them all at once, and each
 * store takes its part instead of reading it.
 *
 * A part is taken once: a store reading again later — a change arriving, a
 * catch-up — reads its own table, as before, rather than an answer from the
 * start of the load. A store also reads for itself when no combined read was
 * asked for, when it failed, when it is older than a minute, or when it was for
 * another organization, or other partner organizations, than the store asks
 * about.
 */

export interface LoadExtras {
  orgIds: string[];
  labels: Record<string, unknown>[];
  labelAssignments: Record<string, unknown>[];
  publishedLinks: Array<{ tree_id: string; backlog_id: string | null }>;
  itemScrambles: Array<{ work_item_id: string; scrambled_by: string | null; with_backlog_id: string | null }>;
  listScrambles: Array<{ backlog_id: string; scrambled_by: string | null; with_backlog_id: string | null }>;
  jiraLinks: Record<string, unknown>[];
  jiraConnections: Record<string, unknown>[];
  teams: Record<string, unknown>[];
  teamMembers: Record<string, unknown>[];
  teamAssignments: Array<{ work_item_id: string; team_id: string }>;
  settings: Record<string, unknown> | null;
  statuses: Record<string, unknown>[];
  snoozes: Record<string, unknown>[];
  targets: Record<string, unknown>[];
  financials: Record<string, unknown>[];
}

export type LoadExtrasPart = Exclude<keyof LoadExtras, "orgIds">;

/** How long a combined read stays good to take from. */
export const LOAD_EXTRAS_MAX_AGE_MS = 60_000;

let current: {
  orgId: string;
  startedAt: number;
  promise: Promise<LoadExtras | null>;
  taken: Set<LoadExtrasPart>;
} | null = null;

/**
 * Ask for the combined read for an organization, if one is not already under
 * way or fresh. `fresh` asks again regardless: a catch-up after a long absence.
 */
export function prefetchLoadExtras(orgId: string, options: { fresh?: boolean } = {}): Promise<LoadExtras | null> {
  if (!options.fresh && current && current.orgId === orgId && Date.now() - current.startedAt < LOAD_EXTRAS_MAX_AGE_MS) {
    return current.promise;
  }
  const promise = (async (): Promise<LoadExtras | null> => {
    try {
      // Imported when first asked, not with this module, so that a test's mock
      // of the client is the one used (see rowMirror.ts).
      const { supabase } = await import("@/integrations/supabase/client");
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data, error } = await (supabase as any).rpc("get_load_extras", { _org_id: orgId });
      if (error || !data || typeof data !== "object" || !Array.isArray((data as LoadExtras).orgIds)) return null;
      return data as LoadExtras;
    } catch {
      return null;
    }
  })();
  current = { orgId, startedAt: Date.now(), promise, taken: new Set() };
  return promise;
}

const sameSet = (a: readonly string[], b: readonly string[]) => {
  const left = new Set(a);
  const right = new Set(b);
  return left.size === right.size && [...left].every((x) => right.has(x));
};

/**
 * A store's part of the combined read, once — or null, and the store reads it
 * itself. `orgId` and `orgIds` are what the store is reading for, where it is
 * reading for particular organizations.
 */
export async function takeLoadExtra<P extends LoadExtrasPart>(
  part: P,
  scope: { orgId?: string; orgIds?: readonly string[] } = {},
): Promise<LoadExtras[P] | null> {
  const entry = current;
  if (!entry) return null;
  if (Date.now() - entry.startedAt > LOAD_EXTRAS_MAX_AGE_MS) return null;
  if (scope.orgId && scope.orgId !== entry.orgId) return null;
  if (entry.taken.has(part)) return null;
  entry.taken.add(part);
  const extras = await entry.promise;
  if (!extras) return null;
  if (scope.orgIds && !sameSet(scope.orgIds, extras.orgIds)) return null;
  const value = extras[part];
  return value === undefined ? null : value;
}

/** Forget any combined read (between tests). */
export function forgetLoadExtras(): void {
  current = null;
}
