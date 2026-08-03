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

  // Filter out anything already imported for this organization.
  const { data: existing, error: existingError } = await admin
    .from('gmail_imported_links')
    .select('gmail_message_id, normalized_url')
    .eq('organization_id', organizationId)
    .in('gmail_message_id', [...new Set([...unique.values()].map((l) => l.messageId))]);
  if (existingError) throw existingError;

  const seen = new Set((existing ?? []).map((r) => `${r.gmail_message_id}|${r.normalized_url}`));
  const fresh = [...unique.entries()].filter(([k]) => !seen.has(k)).map(([, v]) => v);
  const skipped = unique.size - fresh.length;
  if (fresh.length === 0) return { created: 0, skipped, createdIds: [] };

  // Append at the end of the backlog's list order.
  const { data: rankRows, error: rankError } = await admin
    .from('work_item_backlog_ranks')
    .select('rank')
    .eq('backlog_id', backlogId)
    .order('rank', { ascending: false })
    .limit(1);
  if (rankError) throw rankError;
  let nextRank = (rankRows?.[0]?.rank ?? 0) + 1;

  const items = fresh.map((link) => ({
    id: newWorkItemId(organizationId),
    link,
    rank: nextRank++,
  }));

  const { error: itemsError } = await admin.from('work_items').insert(
    items.map(({ id, link, rank }) => ({
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
    items.map(({ id, rank }) => ({
      work_item_id: id,
      backlog_id: backlogId,
      organization_id: organizationId,
      rank,
    })),
  );
  if (ranksError) throw ranksError;

  const { error: boardRanksError } = await admin.from('work_item_board_ranks').insert(
    items.map(({ id, rank }) => ({
      work_item_id: id,
      backlog_id: backlogId,
      organization_id: organizationId,
      rank,
    })),
  );
  if (boardRanksError) throw boardRanksError;

  const { error: linkError } = await admin.from('work_item_hyperlinks').insert(
    items.map(({ id, link }) => ({
      work_item_id: id,
      organization_id: organizationId,
      url: link.url,
      alt_text: link.title || link.url,
      rank: 0,
    })),
  );
  if (linkError) throw linkError;

  const { error: dedupeError } = await admin.from('gmail_imported_links').insert(
    items.map(({ id, link }) => ({
      organization_id: organizationId,
      query_id: queryId ?? null,
      gmail_message_id: link.messageId,
      normalized_url: link.url,
      work_item_id: id,
    })),
  );
  if (dedupeError) throw dedupeError;

  return { created: items.length, skipped, createdIds: items.map((i) => i.id) };
}
