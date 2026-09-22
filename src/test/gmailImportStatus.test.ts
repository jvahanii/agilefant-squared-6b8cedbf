import { describe, it, expect } from 'vitest';
import { importLinksAsWorkItems } from '../../supabase/functions/_shared/gmailImport';

/**
 * The picker lets each imported posting start with a chosen status. The server
 * takes it only when the target backlog actually has that status — anything
 * else, or nothing, means not_started.
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

const link = (url: string, status?: string) => ({
  url,
  title: 'AI Engineer',
  messageId: `m-${url}`,
  subject: 's',
  from: 'duunivahti@duunitori.fi',
  date: '2026-09-21T00:00:00.000Z',
  ...(status ? { status } : {}),
});

const target = { organizationId: 'org', treeId: 'tree', backlogId: 'bl', allowDuplicates: true };

describe('import with a chosen status', () => {
  it('creates the item with the chosen status when the backlog has it', async () => {
    const { admin, inserted } = makeAdmin(['not_started', 'in_progress', 'done']);
    const res = await importLinksAsWorkItems(admin, target, [link('https://x/1', 'in_progress')]);
    expect(res.created).toBe(1);
    expect(inserted.work_items[0]).toMatchObject({ status: 'in_progress' });
  });

  it('falls back to not_started for a status the backlog does not have', async () => {
    const { admin, inserted } = makeAdmin(['not_started', 'done']);
    await importLinksAsWorkItems(admin, target, [link('https://x/2', 'in_progress')]);
    expect(inserted.work_items[0]).toMatchObject({ status: 'not_started' });
  });

  it('uses the default status keys when no backlog has materialized statuses', async () => {
    const { admin, inserted } = makeAdmin([]);
    await importLinksAsWorkItems(admin, target, [link('https://x/3', 'blocked')]);
    expect(inserted.work_items[0]).toMatchObject({ status: 'blocked' });
  });

  it('does not look statuses up when no link carries one', async () => {
    const { admin, inserted, queried } = makeAdmin();
    await importLinksAsWorkItems(admin, target, [link('https://x/4')]);
    expect(inserted.work_items[0]).toMatchObject({ status: 'not_started' });
    expect(queried).not.toContain('backlog_statuses');
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
