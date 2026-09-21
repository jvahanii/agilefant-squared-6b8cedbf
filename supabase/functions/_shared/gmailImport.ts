// Creates work items, one per link, in a target backlog.
//
// De-duplicated by (organization, gmail message id, normalized url) unless the
// target sets allowDuplicates, in which case nothing is recorded or consulted
// and the same posting can be imported as many times as it is offered.

// Type-only, so this module can be unit-tested: gmail.ts pulls the Supabase
// client from a URL, which the test runner cannot resolve. Erased at runtime.

import type { ExtractedLink } from './extract.ts';
import { normalizeUrl } from './urls.ts';
import { canonicalizeByHost, jobSourceFor } from './jobSources.ts';
import { deadlinePrefix } from './deadlines.ts';
import { fillDeadlines } from './fetchDeadline.ts';

/**
 * The service-role client, structurally.
 *
 * This used to be `ReturnType<typeof adminClient>` from ./gmail.ts — a
 * type-only import, but enough to drag that file into the app's typecheck,
 * because tsconfig.app.json includes src and the tests here import this
 * module. gmail.ts is Deno: it imports from esm.sh and reads Deno.env, so
 * `tsc -p tsconfig.app.json` failed on code it was never meant to check.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

export interface ImportTarget {
  organizationId: string;
  treeId: string;
  backlogId: string;
  queryId?: string | null;
  /**
   * Import a posting even if it has been imported before. Job ad import sets
   * this: the backlog is meant to accumulate every sighting, so nothing is
   * remembered between runs and re-running a query yields the items again.
   */
  allowDuplicates?: boolean;
  /**
   * Fetch each posting to find a deadline the mail did not state. Done here
   * rather than during preview: a preview offers dozens of postings, an import
   * takes the handful that were picked, so the requests land where they are few.
   */
  fetchDeadlines?: boolean;
}

export interface ImportResult {
  created: number;
  skipped: number;
  createdIds: string[];
  /** Postings that appeared more than once in this same import and were merged. */
  collapsed: number;
}

function newWorkItemId(orgId: string): string {
  return `${orgId}::wi-${crypto.randomUUID()}`;
}

/**
 * "0920 Academic Work — AI Engineer" when a deadline is known, so a backlog
 * sorted by name groups by closing date. Without one the title is unchanged.
 */
function workItemTitle(link: ExtractedLink): string {
  const prefix = deadlinePrefix(link.deadline);
  const base = link.title || link.url;
  return prefix ? `${prefix} ${base}` : base;
}

function describe(link: ExtractedLink): string {
  const parts = [
    link.deadline
      ? `Applications close: ${link.deadline}`
      : link.deadlineOpen
        ? 'Applications open until further notice'
        : '',
    link.subject ? `From email: ${link.subject}` : '',
    link.from ? `Sender: ${link.from}` : '',
    link.date ? `Received: ${link.date}` : '',
    `Link: ${link.url}`,
  ].filter(Boolean);
  return parts.join('\n');
}

/**
 * Every URL already attached to an item in this backlog, in each form it might
 * be compared against: as stored, normalised, and canonicalised. Items imported
 * before canonicalisation hold raw trackers, so without unwrapping them a
 * posting would look new when it is not.
 *
 * Used to suppress duplicates on the de-duplicating path, and to mark rows the
 * picker offers -- job ad import never blocks, it only says what is already
 * there.
 */
export async function urlsInBacklog(admin: Admin, backlogId: string): Promise<Set<string>> {
  const present = new Set<string>();
  const { data: rankRows } = await admin
    .from('work_item_backlog_ranks')
    .select('work_item_id')
    .eq('backlog_id', backlogId);
  const rankedIds = (rankRows ?? []).map((r) => r.work_item_id as string);
  if (rankedIds.length === 0) return present;

  // A rank row is not evidence that the item is in this backlog: an item
  // carries one assignment per tree, and moving it leaves the old backlog's
  // rank row behind. (A delete no longer does — since 20260914220000 the rank
  // and hyperlink rows cascade with the item.)
  //
  // So require the item to still name this backlog among its assignments.
  // Reading it from work_items also covers a rank row that outlives its item
  // for a moment, such as one written by a save racing a delete.
  const itemIds: string[] = [];
  for (let i = 0; i < rankedIds.length; i += 200) {
    const { data: liveRows } = await admin
      .from('work_items')
      .select('id, backlog_assignments')
      .in('id', rankedIds.slice(i, i + 200));
    for (const r of liveRows ?? []) {
      const assignments = (r.backlog_assignments ?? {}) as Record<string, string>;
      if (Object.values(assignments).includes(backlogId)) itemIds.push(r.id as string);
    }
  }
  if (itemIds.length === 0) return present;

  for (let i = 0; i < itemIds.length; i += 200) {
    const { data: urlRows } = await admin
      .from('work_item_hyperlinks')
      .select('url')
      .in('work_item_id', itemIds.slice(i, i + 200));
    for (const r of urlRows ?? []) {
      const raw = r.url as string;
      present.add(raw);
      const normalized = normalizeUrl(raw);
      if (normalized) {
        present.add(normalized);
        const canonical = canonicalizeByHost(normalized);
        if (canonical) present.add(canonical);
      }
    }
  }
  return present;
}

/**
 * The same question asked of a whole backlog tree: where in it, if anywhere,
 * does each URL already appear?
 *
 * One backlog is the wrong unit for a job hunt. The same posting arrives in two
 * digests a week apart and gets filed into "Applied" the first time and offered
 * again for "Ei ehtinyt hakea" the second, because nothing looked outside the
 * backlog being imported into.
 *
 * Asked of `backlog_assignments` rather than the rank rows urlsInBacklog walks,
 * which is both simpler and truer: an item holds exactly one assignment per
 * tree, keyed by tree id, so naming the tree is the whole query. Rank rows
 * survive a move; assignments do not.
 *
 * The value is the backlog the item sits in, so the picker can say where rather
 * than only that.
 */
export async function urlsInTree(
  admin: Admin,
  organizationId: string,
  treeId: string,
): Promise<Map<string, string>> {
  const found = new Map<string, string>();

  // The key is quoted because a real tree id reads "<org>::bt-…", and PostgREST
  // parses an unquoted "::" as a cast: the filter then matched no item at all,
  // and every posting in the tree was offered as new.
  const inTree: Array<{
    id: string;
    backlog_assignments: Record<string, string>;
    description?: string | null;
  }> = [];
  const PAGE = 1000;
  for (let from = 0; ; from += PAGE) {
    const { data: page, error } = await admin
      .from('work_items')
      .select('id, backlog_assignments, description')
      .eq('organization_id', organizationId)
      .not(`backlog_assignments->>"${treeId}"`, 'is', null)
      .order('id')
      .range(from, from + PAGE - 1);
    if (error) throw error;
    inTree.push(...((page ?? []) as typeof inTree));
    if (!page || page.length < PAGE) break;
  }
  if (inTree.length === 0) return found;

  const backlogOf = new Map<string, string>();
  for (const item of inTree) backlogOf.set(item.id, item.backlog_assignments?.[treeId] ?? '');

  const names = new Map<string, string>();
  const backlogIds = [...new Set([...backlogOf.values()].filter(Boolean))];
  for (let i = 0; i < backlogIds.length; i += 200) {
    const { data: rows } = await admin
      .from('backlogs')
      .select('id, name')
      .in('id', backlogIds.slice(i, i + 200));
    for (const r of rows ?? []) names.set(r.id as string, r.name as string);
  }

  const whereIs = (workItemId: string) => names.get(backlogOf.get(workItemId) ?? '') ?? 'this tree';
  // Every form the URL might be compared against, for the same reason
  // urlsInBacklog keeps all three: older items hold raw trackers.
  const remember = (raw: string, where: string) => {
    if (!found.has(raw)) found.set(raw, where);
    const normalized = normalizeUrl(raw);
    if (normalized) {
      if (!found.has(normalized)) found.set(normalized, where);
      const canonical = canonicalizeByHost(normalized);
      if (canonical && !found.has(canonical)) found.set(canonical, where);
    }
  };

  // The link an import wrote into the description counts as well as the
  // hyperlink rows. Deleting an item cascades its hyperlinks away, and undo
  // brings the item back without them — so a posting deleted and restored had
  // no link left to match, and was offered again as new. The description line
  // is written by the same import and travels with the item.
  for (const item of inTree) {
    for (const url of linksInDescription(item.description)) remember(url, whereIs(item.id));
  }

  const ids = [...backlogOf.keys()];
  for (let i = 0; i < ids.length; i += 200) {
    const { data: urlRows } = await admin
      .from('work_item_hyperlinks')
      .select('work_item_id, url')
      .in('work_item_id', ids.slice(i, i + 200));
    for (const r of urlRows ?? []) remember(r.url as string, whereIs(r.work_item_id as string));
  }
  return found;
}

/** The URLs on describe()'s "Link: …" lines. */
export function linksInDescription(description: string | null | undefined): string[] {
  if (!description) return [];
  return [...description.matchAll(/^Link:[ \t]*(https?:\/\/\S+)[ \t\r]*$/gm)].map((m) => m[1]);
}

/** The fallback when a link names no status, or one the backlog does not have. */
const DEFAULT_STATUS = 'not_started';

/** Status keys every backlog has even with no backlog_statuses rows of its own. */
const DEFAULT_STATUS_KEYS = ['not_started', 'in_progress', 'pending', 'blocked', 'done'];

/**
 * The status keys an item created in this backlog may carry: the nearest
 * materialized set, walking up the backlog parent chain like the client does,
 * or the defaults when no ancestor has rows. A picker can offer a status the
 * actual destination backlog does not have (auto-place files into two other
 * lists); those items fall back to not_started rather than failing.
 */
async function statusKeysFor(admin: Admin, backlogId: string): Promise<Set<string>> {
  let currentId: string | null = backlogId;
  const seen = new Set<string>();
  while (currentId && !seen.has(currentId)) {
    seen.add(currentId);
    const { data: rows } = await admin
      .from('backlog_statuses')
      .select('key')
      .eq('backlog_id', currentId);
    if (rows && rows.length > 0) return new Set(rows.map((r) => r.key as string));
    const { data: backlog } = await admin
      .from('backlogs')
      .select('parent_id')
      .eq('id', currentId)
      .maybeSingle();
    currentId = (backlog?.parent_id as string | null) ?? null;
  }
  return new Set(DEFAULT_STATUS_KEYS);
}

export async function importLinksAsWorkItems(
  admin: Admin,
  target: ImportTarget,
  links: ExtractedLink[],
): Promise<ImportResult> {
  const { organizationId, treeId, backlogId, queryId } = target;
  if (links.length === 0) return { created: 0, skipped: 0, collapsed: 0, createdIds: [] };

  // Resolved once for the batch: only links the picker gave a status need it.
  const allowedStatuses = links.some((l) => l.status) ? await statusKeysFor(admin, backlogId) : null;
  const statusFor = (link: ExtractedLink): string =>
    link.status && allowedStatuses?.has(link.status) ? link.status : DEFAULT_STATUS;

  // Job ad import always imports. Decided from the links themselves rather than
  // from a flag on the request, so it holds even when the caller is an older
  // build, or a saved query predates import_mode and is still marked 'links'.
  const allowDuplicates = target.allowDuplicates === true || links.some((l) => jobSourceFor(l.from));

  // Collapse duplicates inside this run.
  //
  // When duplicates are allowed the key is the URL alone, not message + URL:
  // one posting is mailed by several alerts (LinkedIn re-sends the same role up
  // to five times a day, each its own message), and a single import should
  // still produce a single item. Repetition is wanted *between* runs, not
  // within one.
  const batchKey = (l: ExtractedLink) => (allowDuplicates ? l.url : `${l.messageId}|${l.url}`);
  const unique = new Map<string, ExtractedLink>();
  for (const l of links) if (!unique.has(batchKey(l))) unique.set(batchKey(l), l);
  let candidates = [...unique.values()];
  const collapsed = links.length - unique.size;

  // Safety net for the de-duplicating path: never create a second item for a
  // URL already present as a hyperlink in the target backlog, even if its dedup
  // record is missing (historical partial imports). Skipped when duplicates are
  // allowed -- that is the whole point.
  if (!allowDuplicates) {
    const presentUrls = await urlsInBacklog(admin, backlogId);
    candidates = candidates.filter((l) => !presentUrls.has(l.url));
  }
  if (candidates.length === 0) return { created: 0, skipped: unique.size, collapsed, createdIds: [] };

  if (target.fetchDeadlines) {
    // Best-effort and capped; a posting that will not load simply keeps no date.
    candidates = await fillDeadlines(candidates);
  }

  let items: Array<{ id: string; claimId: string | null; link: ExtractedLink }>;
  let skipped: number;

  if (allowDuplicates) {
    // Nothing is written to gmail_imported_links and nothing is read from it,
    // so re-running a query imports the same postings again.
    items = candidates.map((link) => ({ id: newWorkItemId(organizationId), claimId: null, link }));
    // Nothing was skipped for having been imported before -- nothing is
    // remembered. Anything missing here was the same posting twice in one run.
    skipped = 0;
  } else {
    // CLAIM FIRST: write the dedup rows before creating anything else, ignoring
    // rows that already exist. Only the rows this run actually inserted are ours
    // to import. That makes concurrent and overlapping runs safe; previously
    // items were created first and a single conflicting dedup row aborted the
    // whole batch, leaving orphaned items that got re-imported (and duplicated)
    // on every later run.
    const claimRows = candidates.map((link) => ({
      organization_id: organizationId,
      query_id: queryId ?? null,
      gmail_message_id: link.messageId,
      normalized_url: link.url,
      work_item_id: newWorkItemId(organizationId),
    }));

    const { data: claimed, error: claimError } = await admin
      .from('gmail_imported_links')
      .upsert(claimRows, {
        onConflict: 'organization_id,gmail_message_id,normalized_url',
        ignoreDuplicates: true,
      })
      .select('id, gmail_message_id, normalized_url, work_item_id');
    if (claimError) throw claimError;

    const claimedRows = claimed ?? [];
    skipped = unique.size - claimedRows.length;
    if (claimedRows.length === 0) return { created: 0, skipped, collapsed, createdIds: [] };

    const byKey = new Map(candidates.map((l) => [`${l.messageId}|${l.url}`, l]));
    items = claimedRows
      .map((row) => ({
        id: row.work_item_id as string,
        claimId: row.id as string | null,
        link: byKey.get(`${row.gmail_message_id}|${row.normalized_url}`),
      }))
      .filter((i): i is { id: string; claimId: string | null; link: ExtractedLink } =>
        Boolean(i.link && i.id),
      );
  }

  if (items.length === 0) return { created: 0, skipped, collapsed, createdIds: [] };

  // Append at the end of the backlog's list order.
  const { data: rankRows, error: rankError } = await admin
    .from('work_item_backlog_ranks')
    .select('rank')
    .eq('backlog_id', backlogId)
    .order('rank', { ascending: false })
    .limit(1);
  if (rankError) throw rankError;
  let nextRank = (rankRows?.[0]?.rank ?? 0) + 1;
  const ranked = items.map((i) => ({ ...i, rank: nextRank++ }));

  // If anything below fails, release the claims so the links can be retried.
  const releaseClaims = async () => {
    if (allowDuplicates) return;
    await admin
      .from('gmail_imported_links')
      .delete()
      .in(
        'id',
        ranked.map((i) => i.claimId).filter((id): id is string => Boolean(id)),
      );
  };

  try {
    const { error: itemsError } = await admin.from('work_items').insert(
      ranked.map(({ id, link, rank }) => ({
        id,
        title: workItemTitle(link),
        description: describe(link),
        status: 'not_started',
        parent_id: null,
        organization_id: organizationId,
        rank,
        backlog_assignments: { [treeId]: backlogId },
      })),
    );
    if (itemsError) throw itemsError;

    const { error: ranksError } = await admin.from('work_item_backlog_ranks').insert(
      ranked.map(({ id, rank }) => ({
        work_item_id: id,
        backlog_id: backlogId,
        organization_id: organizationId,
        rank,
      })),
    );
    if (ranksError) throw ranksError;

    const { error: boardRanksError } = await admin.from('work_item_board_ranks').insert(
      ranked.map(({ id, rank }) => ({
        work_item_id: id,
        backlog_id: backlogId,
        organization_id: organizationId,
        rank,
      })),
    );
    if (boardRanksError) throw boardRanksError;

    const { error: linkError } = await admin.from('work_item_hyperlinks').insert(
      ranked.map(({ id, link }) => ({
        work_item_id: id,
        organization_id: organizationId,
        url: link.url,
        alt_text: link.title || link.url,
        rank: 0,
      })),
    );
    if (linkError) throw linkError;
  } catch (err) {
    await releaseClaims();
    throw err;
  }

  return { created: ranked.length, skipped, collapsed, createdIds: ranked.map((i) => i.id) };
}

