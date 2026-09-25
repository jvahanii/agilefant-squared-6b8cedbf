import { describe, it, expect } from 'vitest';
import { importLinksAsWorkItems } from '../../supabase/functions/_shared/gmailImport';

/**
 * The picker lets each imported posting carry a star rating. The server keeps
 * a whole number 1-5; anything else, or nothing, means unrated.
 */

function makeAdmin(statusKeys?: string[]) {
  const inserted: Record<string, unknown[]> = {};
  const queried: string[] = [];

  const from = (table: string) => {
    const ctx: { op: string; cols?: string } = { op: 'select' };
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
      maybeSingle() {
        // The target backlog has no parent.
        return Promise.resolve({ data: { parent_id: null }, error: null });
      },
      then(resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) {
        return Promise.resolve(result()).then(resolve, reject);
      },
    };

    function result() {
      queried.push(table);
      if (ctx.op === 'insert') return { data: null, error: null };
      if (table === 'work_item_backlog_ranks') {
        return ctx.cols === 'rank' ? { data: [], error: null } : { data: [], error: null };
      }
      if (table === 'backlog_statuses') {
        return { data: (statusKeys ?? []).map((key) => ({ key })), error: null };
      }
      return { data: [], error: null };
    }

    return self;
  };

  return { admin: { from } as never, inserted, queried };
}

const link = (url: string, rating?: number) => ({
  url,
  title: 'AI Engineer',
  messageId: `m-${url}`,
  subject: 's',
  from: 'duunivahti@duunitori.fi',
  date: '2026-09-21T00:00:00.000Z',
  ...(rating !== undefined ? { rating } : {}),
});

const target = { organizationId: 'org', treeId: 'tree', backlogId: 'bl', allowDuplicates: true };

describe('import with a chosen rating', () => {
  it('creates the item with the rating the picker chose', async () => {
    const { admin, inserted } = makeAdmin();
    const res = await importLinksAsWorkItems(admin, target, [link('https://x/1', 3)]);
    expect(res.created).toBe(1);
    expect(inserted.work_items[0]).toMatchObject({ rating: 3 });
  });

  it('leaves the item unrated when the picker gave none', async () => {
    const { admin, inserted } = makeAdmin();
    await importLinksAsWorkItems(admin, target, [link('https://x/2')]);
    expect(inserted.work_items[0]).toMatchObject({ rating: null });
  });

  it('drops a rating out of range rather than failing', async () => {
    const { admin, inserted } = makeAdmin();
    await importLinksAsWorkItems(admin, target, [
      link('https://x/3', 0),
      link('https://x/4', 6),
      link('https://x/5', 2.5),
    ]);
    expect(inserted.work_items.map((r) => (r as { rating: number | null }).rating)).toEqual([null, null, null]);
  });
});

describe('import names the item after where the job is', () => {
  it('puts the closing date in front and the cities after, and lists them all in the description', async () => {
    const { admin, inserted } = makeAdmin();
    await importLinksAsWorkItems(admin, target, [
      { ...link('https://x/c1'), title: 'Fortum — Analyst', deadline: '2026-09-30', cities: ['Espoo'] },
      { ...link('https://x/c2'), title: 'HR with you — Open Application', cities: ['Helsinki', 'Tampere', 'Vantaa', 'Turku'] },
      { ...link('https://x/c3'), title: 'Droppe — AI Operations Manager', cities: [] },
    ]);
    const rows = inserted.work_items as { title: string; description: string }[];
    expect(rows.map((r) => r.title)).toEqual([
      '0930 Fortum — Analyst (Espoo)',
      'HR with you — Open Application (Helsinki, Tampere +2)',
      'Droppe — AI Operations Manager',
    ]);
    expect(rows[1].description).toContain('Location: Helsinki, Tampere, Vantaa, Turku');
  });
});

describe('import reports which item it made of each posting', () => {
  it('maps each URL to the item created for it, one per posting even when mailed twice', async () => {
    const { admin, inserted } = makeAdmin();
    const res = await importLinksAsWorkItems(admin, target, [
      link('https://x/m1'),
      link('https://x/m2'),
      // The same posting from a second alert: one item, one entry.
      { ...link('https://x/m1'), messageId: 'm-again' },
    ]);
    const rows = inserted.work_items as { id: string }[];
    expect(Object.keys(res.createdByUrl ?? {})).toEqual(['https://x/m1', 'https://x/m2']);
    expect(Object.values(res.createdByUrl ?? {})).toEqual(rows.map((r) => r.id));
    expect(Object.values(res.createdByUrl ?? {})).toEqual(res.createdIds);
  });
});
