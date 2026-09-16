/**
 * A job hunt is not one list. The same posting arrives in two digests a week
 * apart, and the second offering should say it has been seen — even though it
 * was filed into "Applied" the first time and this import is aimed at a
 * different backlog in the same tree.
 *
 * Which backlog it landed in is asked of backlog_assignments rather than the
 * rank rows urlsInBacklog walks. An item holds one assignment per tree, keyed
 * by tree id, so naming the tree is the whole query — and unlike a rank row, an
 * assignment does not survive the item being moved.
 */
import { describe, it, expect } from 'vitest';
import { urlsInTree } from '../../supabase/functions/_shared/gmailImport';

// Shaped like real ids: "<org>::bt-…".
const TREE = '227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-47861693';
const OTHER_TREE = '227ff1d1-36df-4f46-b97e-483ada92ccfb::bt-00000002';

interface Item {
  id: string;
  backlog_assignments: Record<string, string>;
  description?: string;
}

/**
 * Enough of the client for this one query path: work_items filtered by a jsonb
 * key, then backlogs by id, then hyperlinks by work_item_id.
 */
function makeAdmin(items: Item[], backlogs: Record<string, string>, links: Record<string, string[]>) {
  const calls: string[] = [];
  const from = (table: string) => {
    let notNullKey: string | null = null;
    const self = {
      select: () => self,
      eq: () => self,
      in: () => self,
      order: () => self,
      range: () => self,
      not(column: string) {
        // ".not('backlog_assignments->>\"tree-1\"', 'is', null)" — the key must be
        // quoted: a real tree id holds "::", which PostgREST reads as a cast.
        const quoted = column.match(/^backlog_assignments->>"(.+)"$/);
        if (!quoted) throw new Error(`unquoted jsonb key in filter: ${column}`);
        notNullKey = quoted[1];
        return self;
      },
      then(resolve: (v: unknown) => unknown) {
        calls.push(table);
        if (table === 'work_items') {
          const data = items.filter((i) => (notNullKey ? i.backlog_assignments[notNullKey] : true));
          return Promise.resolve(resolve({ data, error: null }));
        }
        if (table === 'backlogs') {
          return Promise.resolve(
            resolve({ data: Object.entries(backlogs).map(([id, name]) => ({ id, name })), error: null }),
          );
        }
        const rows = Object.entries(links).flatMap(([workItemId, urls]) =>
          urls.map((url) => ({ work_item_id: workItemId, url })),
        );
        return Promise.resolve(resolve({ data: rows, error: null }));
      },
    };
    return self;
  };
  return { admin: { from }, calls };
}

const LINKEDIN = 'https://www.linkedin.com/jobs/view/4458065583/';

describe('urlsInTree', () => {
  it('finds a posting filed into a different backlog of the same tree', async () => {
    const { admin } = makeAdmin(
      [{ id: 'wi-1', backlog_assignments: { [TREE]: 'bl-applied' } }],
      { 'bl-applied': 'Applied' },
      { 'wi-1': [LINKEDIN] },
    );

    const found = await urlsInTree(admin, 'org', TREE);

    expect(found.has(LINKEDIN)).toBe(true);
    // Named, so the picker can say where rather than only that.
    expect(found.get(LINKEDIN)).toBe('Applied');
  });

  it('ignores an item that lives in another tree entirely', async () => {
    const { admin } = makeAdmin(
      [{ id: 'wi-1', backlog_assignments: { [OTHER_TREE]: 'bl-elsewhere' } }],
      { 'bl-elsewhere': 'Somewhere else' },
      { 'wi-1': [LINKEDIN] },
    );

    expect((await urlsInTree(admin, 'org', TREE)).size).toBe(0);
  });

  it('matches a decorated link against the plain one already stored', async () => {
    // The stored item predates canonicalisation and holds a raw tracker; the
    // digest offers the tidy form. Without unwrapping, the posting looks new.
    const stored = 'https://www.linkedin.com/comm/jobs/view/4458065583/?trackingId=abc&refId=def';
    const { admin } = makeAdmin(
      [{ id: 'wi-1', backlog_assignments: { [TREE]: 'bl' } }],
      { bl: 'Ei ehtinyt hakea' },
      { 'wi-1': [stored] },
    );

    const found = await urlsInTree(admin, 'org', TREE);

    expect(found.has('https://www.linkedin.com/jobs/view/4458065583')).toBe(true);
  });

  it('recognises a posting whose hyperlink was lost, by the link in its description', async () => {
    // Real case: "Elisa — Team Manager, AI Development (Helsinki)" was deleted
    // and brought back with undo. The delete cascaded its hyperlink away; the
    // description the import wrote kept the link.
    const description = [
      'From email: Jarno , apply now to ‘Agile Coach at If Insurance’',
      'Sender: LinkedIn <jobs-noreply@linkedin.com>',
      'Received: 2026-09-15T18:53:21.000Z',
      'Link: https://www.linkedin.com/jobs/view/4465791712',
    ].join('\n');
    const { admin } = makeAdmin(
      [{ id: 'wi-1', backlog_assignments: { [TREE]: 'bl-hunt' }, description }],
      { 'bl-hunt': 'Applied' },
      {},
    );

    const found = await urlsInTree(admin, 'org', TREE);

    expect(found.get('https://www.linkedin.com/jobs/view/4465791712')).toBe('Applied');
  });

  it('asks nothing further when the tree holds no items', async () => {
    const { admin, calls } = makeAdmin([], {}, {});

    expect((await urlsInTree(admin, 'org', TREE)).size).toBe(0);
    expect(calls).toEqual(['work_items']);
  });

  it('still answers when the backlog has no name to give', async () => {
    const { admin } = makeAdmin(
      [{ id: 'wi-1', backlog_assignments: { [TREE]: 'bl-gone' } }],
      {},
      { 'wi-1': [LINKEDIN] },
    );

    expect((await urlsInTree(admin, 'org', TREE)).get(LINKEDIN)).toBe('this tree');
  });
});
