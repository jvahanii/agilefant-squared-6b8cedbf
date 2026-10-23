import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import { jiraPort } from '../../supabase/functions/_shared/jiraApi';
import { normalizeHyperlinks, reconcile, type SyncState } from '../../supabase/functions/_shared/jiraMapping';
import { JiraSync, type AgilefantPort, type JiraPort, type Link, type AgilefantItem } from '../../supabase/functions/_shared/jiraEngine';

const a = { url: 'https://example.com/a', title: 'A' };
const b = { url: 'https://example.com/b', title: 'B' };
const base: SyncState = { title: 'Item', description: '', status: 'To Do', points: null, parent: null, hyperlinks: [] };
const config = { baseUrl: 'https://example.atlassian.net', email: 'test@example.com', token: 'test', projectKey: 'AF', pointsField: null };
beforeAll(() => {
  vi.stubGlobal('AbortSignal', { timeout: () => new AbortController().signal });
});
afterAll(() => vi.unstubAllGlobals());

describe('external web links', () => {
  it('accepts only http and https URLs', () => {
    expect(normalizeHyperlinks([a, { url: 'javascript:alert(1)' }, { url: 'ftp://example.com' }, { url: 'bad' }])).toEqual([a]);
  });
  it('merges existing links when the historical baseline has no hyperlinks', () => {
    const old = { ...base }; delete old.hyperlinks;
    expect(reconcile(old, { ...base, hyperlinks: [a] }, { ...base, hyperlinks: [b] }, null, null).state.hyperlinks).toEqual([a, b]);
  });
  it('preserves independent concurrent additions', () => {
    expect(reconcile(base, { ...base, hyperlinks: [a] }, { ...base, hyperlinks: [b] }, null, null).state.hyperlinks).toEqual([a, b]);
  });
  it.each(['Agilefant', 'Jira'])('propagates deletion from %s without resurrection', (side) => {
    const old = { ...base, hyperlinks: [a] };
    const result = reconcile(old, side === 'Agilefant' ? base : old, side === 'Jira' ? base : old, null, null);
    expect(result.state.hyperlinks).toEqual([]);
    expect(side === 'Agilefant' ? result.toJira : result.toAgilefant).toContain('hyperlinks');
  });
  it('propagates a changed link title', () => {
    const old = { ...base, hyperlinks: [a] };
    expect(reconcile(old, { ...base, hyperlinks: [{ ...a, title: 'Edited' }] }, old, null, null).state.hyperlinks).toEqual([{ ...a, title: 'Edited' }]);
  });
  it('does not echo unchanged links in a different display order', () => {
    const state = { ...base, hyperlinks: [a, b] };
    const result = reconcile(state, { ...state, hyperlinks: [b, a] }, state, null, null);
    expect(result.toJira).toEqual([]); expect(result.toAgilefant).toEqual([]);
  });
  it('writes web links using remote-link endpoints and leaves application links alone', async () => {
    const calls: { url: string; method?: string; body?: unknown }[] = [];
    const port = jiraPort(config, async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(String(init.body)) : undefined });
      if (init.method === 'GET') return new Response(JSON.stringify([
        { id: 1, object: a },
        { id: 2, object: b },
        { id: 3, application: { type: 'com.atlassian.confluence' }, object: { url: 'https://wiki.example.com', title: 'Wiki' } },
      ]));
      return new Response(null, { status: 204 });
    });
    await port.updateIssue('100', ['hyperlinks'], { ...base, hyperlinks: [{ ...a, title: 'Edited' }, { url: 'https://example.com/c', title: 'C' }] });
    expect(calls.find((c) => c.method === 'PUT')?.body).toEqual({ object: { ...a, title: 'Edited' } });
    expect(calls.filter((c) => c.method === 'DELETE').map((c) => c.url)).toEqual([`${config.baseUrl}/rest/api/3/issue/100/remotelink/2`]);
    expect(calls.find((c) => c.method === 'POST')?.body).toEqual({ globalId: 'agilefant:web:https://example.com/c', object: { url: 'https://example.com/c', title: 'C' } });
  });
  it('reads Jira web links but not application links', async () => {
    const port = jiraPort(config, async (url) => new Response(JSON.stringify(url.includes('/remotelink')
      ? [{ id: 1, object: a }, { id: 2, application: { name: 'Other app' }, object: b }]
      : { id: '100', key: 'AF-1', fields: { summary: 'Item' } })));
    expect((await port.getIssue('100'))?.state.hyperlinks).toEqual([a]);
  });
  it('does not interpret a remote-link read failure as an issue deletion', async () => {
    const port = jiraPort(config, async (url) => url.includes('/remotelink')
      ? new Response('missing endpoint', { status: 404 })
      : new Response(JSON.stringify({ id: '100', key: 'AF-1', fields: { summary: 'Item' } })));
    await expect(port.getIssue('100')).rejects.toThrow('404');
  });
  it('runs the engine both ways and reads the saved links back without echoes', async () => {
    let item: AgilefantItem = { id: 'wi-1', title: 'Item', description: '', status: 'not_started', points: null, parentId: null, inList: true, hyperlinks: [] };
    let issue = { id: '100', key: 'AF-1', type: 'Task', state: { ...base, hyperlinks: [a] }, statusCategory: null, updatedAt: 0 };
    let link: Link = { workItemId: item.id, jiraId: issue.id, jiraKey: issue.key, jiraType: 'Task', agreed: base };
    let writes = 0;
    const af: AgilefantPort = {
      listItems: async () => [item], getItem: async () => item,
      createItem: async () => 'unused', deleteItem: async () => {}, dropLink: async () => {},
      updateItem: async (_id, fields) => { item = { ...item, ...fields }; writes++; },
      links: async () => [link], saveLink: async (next) => { link = next; },
    };
    const jira: JiraPort = {
      listIssues: async () => [issue], getIssue: async () => issue,
      createIssue: async () => ({ id: 'unused', key: 'unused' }), deleteIssue: async () => {}, changeType: async () => {},
      updateIssue: async (_id, fields, state) => {
        if (fields.includes('hyperlinks')) issue = { ...issue, state: { ...issue.state, hyperlinks: state.hyperlinks ?? [] } };
        writes++;
      },
    };
    await new JiraSync(jira, af).syncIssue(issue.id);
    expect((await af.getItem(item.id))?.hyperlinks).toEqual([a]);
    item = { ...item, hyperlinks: [a, b] };
    await new JiraSync(jira, af).syncItem(item.id);
    expect((await jira.getIssue(issue.id))?.state.hyperlinks).toEqual([a, b]);
    issue = { ...issue, state: { ...issue.state, hyperlinks: [b] } };
    await new JiraSync(jira, af).syncHyperlinks();
    expect((await af.getItem(item.id))?.hyperlinks).toEqual([b]);
    const before = writes;
    await new JiraSync(jira, af).syncHyperlinks();
    expect(writes).toBe(before);
  });
});