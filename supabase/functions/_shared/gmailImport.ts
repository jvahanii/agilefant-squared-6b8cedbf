// Creates work items, one per link, in a target backlog.
//
// De-duplicated by (organization, gmail message id, normalized url) unless the
// target sets allowDuplicates, in which case nothing is recorded or consulted
// and the same posting can be imported as many times as it is offered.

// Type-only, so this module can be unit-tested: gmail.ts pulls the Supabase
// client from a URL, which the test runner cannot resolve. Erased at runtime.
import type { adminClient } from './gmail.ts';
import type { ExtractedLink } from './extract.ts';
import { normalizeUrl } from './urls.ts';
import { canonicalizeByHost, jobSourceFor } from './jobSources.ts';

type Admin = ReturnType<typeof adminClient>;

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

function describe(link: ExtractedLink): string {
  const parts = [
    link.subject ? `From email: ${link.subject}` : '',
    link.from ? `Sender: ${link.from}` : '',
    link.date ? `Received: ${link.date}` : '',
    `Link: ${link.url}`,
  ].filter(Boolean);
  return parts.join('\n');
}

export async function importLinksAsWorkItems(
  admin: Admin,
  target: ImportTarget,
  links: ExtractedLink[],
): Promise<ImportResult> {
  const { organizationId, treeId, backlogId, queryId } = target;
  if (links.length === 0) return { created: 0, skipped: 0, collapsed: 0, createdIds: [] };

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
    const { data: existingRankRows } = await admin
      .from('work_item_backlog_ranks')
      .select('work_item_id')
      .eq('backlog_id', backlogId);
    const existingItemIds = (existingRankRows ?? []).map((r) => r.work_item_id as string);
    if (existingItemIds.length > 0) {
      const presentUrls = new Set<string>();
      for (let i = 0; i < existingItemIds.length; i += 200) {
        const { data: urlRows } = await admin
          .from('work_item_hyperlinks')
          .select('url')
          .in('work_item_id', existingItemIds.slice(i, i + 200));
        for (const r of urlRows ?? []) {
          const raw = r.url as string;
          presentUrls.add(raw);
          // Items imported before canonicalisation hold trackers; unwrap them
          // so they still match what the pipeline produces today.
          const normalized = normalizeUrl(raw);
          if (normalized) {
            presentUrls.add(normalized);
            const canonical = canonicalizeByHost(normalized);
            if (canonical) presentUrls.add(canonical);
          }
        }
      }
      candidates = candidates.filter((l) => !presentUrls.has(l.url));
    }
  }
  if (candidates.length === 0) return { created: 0, skipped: unique.size, collapsed, createdIds: [] };

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
        title: link.title || link.url,
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

