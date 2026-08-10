// Creates work items (one per link) in a target backlog, de-duplicated by
// (organization, gmail message id, normalized url).

import { adminClient, ExtractedLink } from './gmail.ts';

type Admin = ReturnType<typeof adminClient>;

export interface ImportTarget {
  organizationId: string;
  treeId: string;
  backlogId: string;
  queryId?: string | null;
}

export interface ImportResult {
  created: number;
  skipped: number;
  createdIds: string[];
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
  if (links.length === 0) return { created: 0, skipped: 0, createdIds: [] };

  // Drop duplicates inside the batch itself.
  const unique = new Map<string, ExtractedLink>();
  for (const l of links) unique.set(`${l.messageId}|${l.url}`, l);
  const candidates = [...unique.values()];

  // CLAIM FIRST: write the dedup rows before creating anything else, ignoring
  // rows that already exist. Only the rows this run actually inserted are ours
  // to import. This makes concurrent/overlapping runs and partial conflicts
  // safe — previously items were created first and a single conflicting dedup
  // row aborted the whole batch, leaving orphaned items that got re-imported
  // (and duplicated) on every later run.
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
  const skipped = candidates.length - claimedRows.length;
  if (claimedRows.length === 0) return { created: 0, skipped, createdIds: [] };

  const byKey = new Map(candidates.map((l) => [`${l.messageId}|${l.url}`, l]));
  const items = claimedRows
    .map((row) => ({
      id: row.work_item_id as string,
      claimId: row.id as string,
      link: byKey.get(`${row.gmail_message_id}|${row.normalized_url}`),
    }))
    .filter((i): i is { id: string; claimId: string; link: ExtractedLink } => Boolean(i.link && i.id));

  if (items.length === 0) return { created: 0, skipped, createdIds: [] };

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
    await admin
      .from('gmail_imported_links')
      .delete()
      .in('id', ranked.map((i) => i.claimId));
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

  return { created: ranked.length, skipped, createdIds: ranked.map((i) => i.id) };
}

