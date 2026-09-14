import { describe, it, expect } from 'vitest';
import {
  importLinksAsWorkItems,
  urlsInBacklog,
} from '../../supabase/functions/_shared/gmailImport';

/**
 * Job ad import keeps no memory of what it has imported, so running a query
 * again brings the same postings back. Within one run it still yields one item
 * per posting: a single role is mailed by several alerts (LinkedIn re-sends the
 * same job up to five times a day, each its own message) and one import should
 * not produce five rows.
 */

interface StubState {
  /** work_item_ids already ranked into the target backlog. */
  existingItemIds?: string[];
  /** urls already attached as hyperlinks to those items. */
  existingUrls?: string[];
  /** Ranked into the backlog but no longer present in work_items. */
  orphanedItemIds?: string[];
}

function makeAdmin(state: StubState = {}) {
  const inserted: Record<string, unknown[]> = {};
  const upserted: unknown[] = [];

  const from = (table: string) => {
    const ctx: { op: string; cols?: string; rows?: unknown[] } = { op: 'select' };
    const self = {
      select(cols?: string) {
        if (ctx.op === 'select') ctx.cols = cols;
        return self;
      },
      eq: () => self,
      in: () => self,
      order: () => self,
      limit: () => self,
      insert(rows: unknown[]) {
        ctx.op = 'insert';
        (inserted[table] ??= []).push(...rows);
        return self;
      },
      upsert(rows: unknown[]) {
        ctx.op = 'upsert';
        ctx.rows = rows;
        upserted.push(...rows);
        return self;
      },
      delete() {
        ctx.op = 'delete';
        return self;
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };

    function result() {
      if (ctx.op === 'insert' || ctx.op === 'delete') return { data: null, error: null };
      if (ctx.op === 'upsert') {
        // Every claim is treated as newly inserted.
        const rows = (ctx.rows ?? []).map((r, i) => ({ ...(r as object), id: `claim-${i}` }));
        return { data: rows, error: null };
      }
      if (table === 'work_item_backlog_ranks') {
        if (ctx.cols === 'rank') return { data: [{ rank: 7 }], error: null };
        return {
          data: [...(state.existingItemIds ?? []), ...(state.orphanedItemIds ?? [])].map((id) => ({
            work_item_id: id,
          })),
          error: null,
        };
      }
      if (table === 'work_items') {
        // Only the ids that still exist come back; orphaned ranks do not.
        return { data: (state.existingItemIds ?? []).map((id) => ({ id })), error: null };
      }
      if (table === 'work_item_hyperlinks') {
        return { data: (state.existingUrls ?? []).map((url) => ({ url })), error: null };
      }
      return { data: [], error: null };
    }

    return self;
  };

  return { admin: { from } as never, inserted, upserted };
}

const link = (messageId: string, url: string, title: string, sender = 'duunivahti@duunitori.fi') => ({
  url,
  title,
  messageId,
  subject: 's',
  from: sender,
  date: '2026-09-13T00:00:00.000Z',
});

const A = 'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347';
const B = 'https://duunitori.fi/tyopaikat/tyo/specialist-paid-social-scsom-20567401';

const target = { organizationId: 'org', treeId: 'tree', backlogId: 'bl', allowDuplicates: true };
/** A sender with no job-source profile, so the de-duplicating path applies. */
const plain = (messageId: string, url: string, title: string) =>
  link(messageId, url, title, 'colleague@example.com');

describe('job ad import: no memory between runs', () => {
  it('creates one item per posting even when several alerts carried it', () => {
    // Five messages, three of them the same role -- the LinkedIn resend pattern.
    const links = [
      link('m1', A, 'AI Engineer'),
      link('m2', A, 'AI Engineer'),
      link('m3', A, 'AI Engineer'),
      link('m4', B, 'Specialist, Paid Social'),
      link('m5', B, 'Specialist, Paid Social'),
    ];
    const { admin, inserted } = makeAdmin();
    return importLinksAsWorkItems(admin, target, links).then((r) => {
      expect(r.created).toBe(2);
      expect(inserted['work_items']).toHaveLength(2);
      expect(inserted['work_item_hyperlinks']).toHaveLength(2);
    });
  });

  it('records nothing, so the next run imports the same postings again', async () => {
    const links = [link('m1', A, 'AI Engineer'), link('m2', B, 'Specialist, Paid Social')];

    const first = makeAdmin();
    const r1 = await importLinksAsWorkItems(first.admin, target, links);
    expect(r1.created).toBe(2);
    expect(first.upserted).toHaveLength(0); // nothing claimed

    // A later run, against a backlog that already holds both postings.
    const second = makeAdmin({ existingItemIds: r1.createdIds, existingUrls: [A, B] });
    const r2 = await importLinksAsWorkItems(second.admin, target, links);
    expect(r2.created).toBe(2);
    expect(r2.skipped).toBe(0);
    expect(second.upserted).toHaveLength(0);
  });

  it('gives each run its own work item ids', async () => {
    const links = [link('m1', A, 'AI Engineer')];
    const a = await importLinksAsWorkItems(makeAdmin().admin, target, links);
    const b = await importLinksAsWorkItems(makeAdmin().admin, target, links);
    expect(a.createdIds[0]).not.toBe(b.createdIds[0]);
  });
});

describe('generic link import still de-duplicates', () => {
  const dedupTarget = { organizationId: 'org', treeId: 'tree', backlogId: 'bl' };

  it('claims each link and skips one already attached in the backlog', async () => {
    const links = [plain('m1', A, 'AI Engineer'), plain('m2', B, 'Specialist, Paid Social')];
    const { admin, upserted } = makeAdmin({ existingItemIds: ['wi-old'], existingUrls: [A] });
    const r = await importLinksAsWorkItems(admin, dedupTarget, links);
    expect(r.created).toBe(1); // A was already present
    expect(r.skipped).toBe(1);
    expect(upserted).toHaveLength(1);
  });

  it('treats the same posting from two messages as two claims', async () => {
    const links = [plain('m1', A, 'AI Engineer'), plain('m2', A, 'AI Engineer')];
    const { admin } = makeAdmin();
    const r = await importLinksAsWorkItems(admin, dedupTarget, links);
    // The dedup key is message + url, which is the pre-existing behaviour.
    expect(r.created).toBe(2);
  });
});

describe('job ad import always imports, whatever the caller says', () => {
  const noFlag = { organizationId: 'org', treeId: 'tree', backlogId: 'bl' };

  it('imports job-source links even when the request sets no flag at all', async () => {
    // Guards the case that kept reporting "already imported": an older client,
    // or a saved query created before import_mode existed and still marked
    // 'links'. The senders decide, not the request.
    const links = [link('m1', A, 'AI Engineer'), link('m2', B, 'Specialist, Paid Social')];
    const { admin, upserted } = makeAdmin({ existingItemIds: ['wi-old'], existingUrls: [A, B] });
    const r = await importLinksAsWorkItems(admin, noFlag, links);
    expect(r.created).toBe(2);
    expect(r.skipped).toBe(0);
    expect(upserted).toHaveLength(0);
  });

  it('never reports job postings as already imported', async () => {
    const links = [link('m1', A, 'AI Engineer')];
    const first = await importLinksAsWorkItems(makeAdmin().admin, noFlag, links);
    const second = await importLinksAsWorkItems(
      makeAdmin({ existingItemIds: first.createdIds, existingUrls: [A] }).admin,
      noFlag,
      links,
    );
    expect(second.skipped).toBe(0);
    expect(second.created).toBe(1);
  });

  it('reports within-run duplicates as merged, not as already imported', async () => {
    // Three alerts carrying one role, plus one other -- a single LinkedIn day.
    const links = [
      link('m1', A, 'AI Engineer'),
      link('m2', A, 'AI Engineer'),
      link('m3', A, 'AI Engineer'),
      link('m4', B, 'Specialist, Paid Social'),
    ];
    const r = await importLinksAsWorkItems(makeAdmin().admin, noFlag, links);
    expect(r.created).toBe(2);
    expect(r.collapsed).toBe(2);
    expect(r.skipped).toBe(0);
  });

  it('applies to every job source, not just one', async () => {
    const links = [
      link('m1', 'https://www.linkedin.com/jobs/view/4401728681', 'Role', 'jobalerts-noreply@linkedin.com'),
    ];
    const { admin } = makeAdmin({ existingItemIds: ['wi-old'], existingUrls: ['https://www.linkedin.com/jobs/view/4401728681'] });
    const r = await importLinksAsWorkItems(admin, noFlag, links);
    expect(r.created).toBe(1);
  });
});

describe('urlsInBacklog', () => {
  const JOBLY_TRACKER =
    'https://mandrillapp.com/track/click/30900652/www.jobly.fi?p=eyJzIjoiaW4xWUhaUUVwY093d1ZXNW1KMnJueEVQNERVIiwidiI6MiwicCI6IntcInVcIjozMDkwMDY1MixcInZcIjoyLFwidXJsXCI6XCJodHRwczpcXFwvXFxcL3d3dy5qb2JseS5maVxcXC90eW9wYWlra2FcXFwvb3BzLXNwZWNpYWxpc3QtdHV1c3VsYS1oZWxzaW5raS0yNzM0NzM0XCJ9In0';
  const JOBLY_CANONICAL = 'https://www.jobly.fi/tyopaikka/ops-specialist-tuusula-helsinki-2734734';

  it('is empty for a backlog with no items', async () => {
    const { admin } = makeAdmin();
    expect((await urlsInBacklog(admin, 'bl')).size).toBe(0);
  });

  it('reports a stored URL in every form it might be compared against', async () => {
    // An item imported before canonicalisation holds the raw tracker. The
    // picker compares canonical URLs, so without unwrapping it the posting
    // would look new when it is already in the backlog.
    const { admin } = makeAdmin({ existingItemIds: ['wi-1'], existingUrls: [JOBLY_TRACKER] });
    const present = await urlsInBacklog(admin, 'bl');
    expect(present.has(JOBLY_TRACKER)).toBe(true);
    expect(present.has(JOBLY_CANONICAL)).toBe(true);
  });

  it('matches a canonical URL stored as-is', async () => {
    const { admin } = makeAdmin({ existingItemIds: ['wi-1'], existingUrls: [JOBLY_CANONICAL] });
    expect((await urlsInBacklog(admin, 'bl')).has(JOBLY_CANONICAL)).toBe(true);
  });

  it('leaves a posting that is not in the backlog unmatched', async () => {
    const { admin } = makeAdmin({ existingItemIds: ['wi-1'], existingUrls: [JOBLY_CANONICAL] });
    const present = await urlsInBacklog(admin, 'bl');
    expect(present.has('https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347')).toBe(false);
  });
});

describe('deleted items do not count as present', () => {
  const A2 = 'https://www.linkedin.com/jobs/view/4444116317';

  it('ignores hyperlinks left behind by a deleted item', () => {
    // Deleting a work item leaves its rank and hyperlink rows behind. A backlog
    // emptied by hand still had 21 rank rows and 0 items, and the picker marked
    // its postings "in this backlog" with nothing in it.
    const { admin } = makeAdmin({ orphanedItemIds: ['wi-deleted'], existingUrls: [A2] });
    return urlsInBacklog(admin, 'bl').then((present) => {
      expect(present.size).toBe(0);
    });
  });

  it('still reports hyperlinks on items that do exist', async () => {
    const { admin } = makeAdmin({ existingItemIds: ['wi-live'], existingUrls: [A2] });
    expect((await urlsInBacklog(admin, 'bl')).has(A2)).toBe(true);
  });

  it('reports the live ones and not the dead ones together', async () => {
    const { admin } = makeAdmin({
      existingItemIds: ['wi-live'],
      orphanedItemIds: ['wi-deleted'],
      existingUrls: [A2],
    });
    // The stub returns the same hyperlink set for whichever ids are queried, so
    // what matters is that a live item is required for any of it to count.
    expect((await urlsInBacklog(admin, 'bl')).has(A2)).toBe(true);
  });

  it('re-offers a posting after its item is deleted', async () => {
    // The point of the whole thing: clearing a backlog must make its postings
    // importable again, not leave them permanently marked.
    const links = [link('m1', A2, 'Aiven — Lead People Partner')];
    const { admin } = makeAdmin({ orphanedItemIds: ['wi-deleted'], existingUrls: [A2] });
    const r = await importLinksAsWorkItems(
      admin,
      { organizationId: 'org', treeId: 'tree', backlogId: 'bl' },
      links,
    );
    expect(r.created).toBe(1);
  });
});
