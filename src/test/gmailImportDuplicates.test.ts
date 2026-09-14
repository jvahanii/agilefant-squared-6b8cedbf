import { describe, it, expect } from 'vitest';
import { importLinksAsWorkItems } from '../../supabase/functions/_shared/gmailImport';

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
        return { data: (state.existingItemIds ?? []).map((id) => ({ work_item_id: id })), error: null };
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

const link = (messageId: string, url: string, title: string) => ({
  url,
  title,
  messageId,
  subject: 's',
  from: 'duunivahti@duunitori.fi',
  date: '2026-09-13T00:00:00.000Z',
});

const A = 'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347';
const B = 'https://duunitori.fi/tyopaikat/tyo/specialist-paid-social-scsom-20567401';

const target = { organizationId: 'org', treeId: 'tree', backlogId: 'bl', allowDuplicates: true };

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
    const links = [link('m1', A, 'AI Engineer'), link('m2', B, 'Specialist, Paid Social')];
    const { admin, upserted } = makeAdmin({ existingItemIds: ['wi-old'], existingUrls: [A] });
    const r = await importLinksAsWorkItems(admin, dedupTarget, links);
    expect(r.created).toBe(1); // A was already present
    expect(r.skipped).toBe(1);
    expect(upserted).toHaveLength(1);
  });

  it('treats the same posting from two messages as two claims', async () => {
    const links = [link('m1', A, 'AI Engineer'), link('m2', A, 'AI Engineer')];
    const { admin } = makeAdmin();
    const r = await importLinksAsWorkItems(admin, dedupTarget, links);
    // The dedup key is message + url, which is the pre-existing behaviour.
    expect(r.created).toBe(2);
  });
});
