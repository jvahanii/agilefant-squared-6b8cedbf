// Agilefant ↔ Jira Cloud: Jira spaces kept in step with lists, both ways.
//
// Each space chosen is a connection of its own — one space, one list — with
// its own webhook, queue and lock; the Jira site and account are shared by an
// organization's spaces.
//
// Who calls this:
//   the app        status · projects · addSpace · removeSpace · sync (now) ·
//                  disconnect — signed in, an owner or admin for anything that
//                  changes which spaces are kept in step
//   the database   drain — a trigger queued changed items (no sign-in: all it
//                  can do is work through what is already queued)
//   Jira           webhook — an issue changed; the URL carries the space's
//                  secret
//
// The rules of what stands for what are in _shared/jiraMapping.ts and the
// order of doing things in _shared/jiraEngine.ts. This file is the wiring:
// the real Jira, the real database, the queue and its lock.

import { adminClient, corsHeaders, json } from '../_shared/gmail.ts';
import { requireAppUser } from '../_shared/auth.ts';
import { jiraPort, JiraError, type JiraConfig } from '../_shared/jiraApi.ts';
import { JiraSync, type AgilefantItem, type AgilefantPort, type Link } from '../_shared/jiraEngine.ts';
import { normalizeHyperlinks, type SyncState, type SyncHyperlink } from '../_shared/jiraMapping.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

interface Connection {
  id: string;
  organization_id: string;
  base_url: string;
  email: string;
  project_key: string;
  project_name: string | null;
  project_id: string | null;
  tree_id: string;
  backlog_id: string;
  points_field: string | null;
  enabled: boolean;
  webhook_secret: string;
  webhook_url: string | null;
  last_synced_at: string | null;
  last_error: string | null;
  issue_types: Array<{ name: string; level: number }> | null;
}

/** How long one call keeps working through a queue before leaving the rest to the next. */
const DRAIN_BUDGET_MS = 45_000;
/** Queue rows taken at a time. */
const DRAIN_BATCH = 50;

function token(): string {
  const value = Deno.env.get('JIRA_API_TOKEN');
  if (!value) throw new Error('jira_token_missing');
  return value;
}

function configFor(conn: Connection): JiraConfig {
  return {
    baseUrl: conn.base_url,
    email: conn.email,
    token: token(),
    projectKey: conn.project_key,
    pointsField: conn.points_field,
  };
}

/** An organization's spaces, by project key. */
async function getConnections(admin: Admin, organizationId: string): Promise<Connection[]> {
  const { data, error } = await admin.from('jira_connections').select('*').eq('organization_id', organizationId).order('project_key');
  if (error) throw error;
  return (data ?? []) as Connection[];
}

/** One space, if it is the organization's. */
async function getConnection(admin: Admin, organizationId: string, id: string): Promise<Connection | null> {
  const { data, error } = await admin.from('jira_connections').select('*').eq('id', id).eq('organization_id', organizationId).maybeSingle();
  if (error) throw error;
  return data as Connection | null;
}

// ─── Agilefant, as the engine sees it ────────────────────────────────────────

function agilefantPort(admin: Admin, conn: Connection): AgilefantPort {
  const org = conn.organization_id;
  const tree = conn.tree_id;
  const today = () => new Date().toISOString().slice(0, 10);

  const readHyperlinks = async (id: string): Promise<SyncHyperlink[]> => {
    const { data, error } = await admin.from('work_item_hyperlinks').select('url, alt_text').eq('work_item_id', id);
    if (error) throw error;
    return normalizeHyperlinks((data ?? []).map((h: { url: string; alt_text: string }) => ({ url: h.url, title: h.alt_text })));
  };
  const writeHyperlinks = async (id: string, links: SyncHyperlink[]) => {
    const { data, error } = await admin.from('work_item_hyperlinks').select('id, url, alt_text, rank').eq('work_item_id', id);
    if (error) throw error;
    const wanted = normalizeHyperlinks(links);
    const kept = new Set<string>();
    for (const row of data ?? []) {
      const target = wanted.find((h) => h.url === row.url);
      if (!target || kept.has(row.url)) {
        const { error } = await admin.from('work_item_hyperlinks').delete().eq('id', row.id);
        if (error) throw error;
      } else {
        kept.add(row.url);
        if ((row.alt_text || row.url) !== target.title) {
          const { error } = await admin.from('work_item_hyperlinks').update({ alt_text: target.title }).eq('id', row.id);
          if (error) throw error;
        }
      }
    }
    let rank = Math.max(0, ...(data ?? []).map((r: { rank: number }) => r.rank ?? 0));
    const rows = wanted.filter((h) => !kept.has(h.url)).map((h) => ({
      work_item_id: id, organization_id: org, url: h.url, alt_text: h.title, rank: ++rank,
    }));
    if (rows.length) {
      const { error } = await admin.from('work_item_hyperlinks').insert(rows);
      if (error) throw error;
    }
  };

  const asItem = (row: {
    id: string;
    title: string;
    description: string | null;
    status: string;
    points: number | null;
    parent_id: string | null;
  }, inList: boolean, parentInList: boolean): AgilefantItem => ({
    id: row.id,
    title: row.title,
    description: row.description,
    status: row.status,
    points: row.points,
    parentId: parentInList ? row.parent_id : null,
    inList,
  });

  /** The nearest list, the connected one or a parent, that has statuses of its own. */
  const statusOwner = async (): Promise<string | null> => {
    let id: string | null = conn.backlog_id;
    for (let i = 0; id && i < 20; i++) {
      const { count } = await admin.from('backlog_statuses').select('id', { count: 'exact', head: true }).eq('backlog_id', id);
      if ((count ?? 0) > 0) return id;
      const { data } = await admin.from('backlogs').select('parent_id').eq('id', id).maybeSingle();
      id = (data?.parent_id as string | null) ?? null;
    }
    return null;
  };

  return {
    async listItems() {
      const { data, error } = await admin.rpc('jira_list_items_for', { _connection: conn.id });
      if (error) throw error;
      const rows = (data ?? []) as Array<Parameters<typeof asItem>[0]>;
      const ids = new Set(rows.map((r) => r.id));
      const { data: hyperlinks, error: linkError } = await admin.from('work_item_hyperlinks')
        .select('work_item_id, url, alt_text').eq('organization_id', org);
      if (linkError) throw linkError;
      return rows.map((r) => ({ ...asItem(r, true, !!r.parent_id && ids.has(r.parent_id)),
        hyperlinks: normalizeHyperlinks((hyperlinks ?? []).filter((h: { work_item_id: string }) => h.work_item_id === r.id)
          .map((h: { url: string; alt_text: string }) => ({ url: h.url, title: h.alt_text }))),
      }));
    },

    async getItem(id) {
      const { data, error } = await admin
        .from('work_items')
        .select('id, title, description, status, points, parent_id, parent_id_overrides, backlog_assignments, organization_id')
        .eq('id', id)
        .maybeSingle();
      if (error) throw error;
      if (!data || data.organization_id !== org) return null;
      const inList = data.backlog_assignments?.[tree] === conn.backlog_id;
      const parentId: string | null = data.parent_id_overrides?.[tree] ?? data.parent_id ?? null;
      let parentInList = false;
      if (parentId) {
        const { data: parent } = await admin.from('work_items').select('backlog_assignments').eq('id', parentId).maybeSingle();
        parentInList = parent?.backlog_assignments?.[tree] === conn.backlog_id;
      }
      return { ...asItem({ ...data, parent_id: parentId }, inList, parentInList), hyperlinks: await readHyperlinks(id) };
    },

    async createItem(fields) {
      const id = `${org}::wi-${crypto.randomUUID()}`;
      const { data: last } = await admin
        .from('work_item_backlog_ranks')
        .select('rank')
        .eq('backlog_id', conn.backlog_id)
        .order('rank', { ascending: false })
        .limit(1);
      const rank = (last?.[0]?.rank ?? 0) + 1;
      const { error } = await admin.from('work_items').insert({
        id,
        title: fields.title,
        description: fields.description || null,
        status: fields.status,
        points: fields.points,
        parent_id: fields.parentId,
        backlog_assignments: { [tree]: conn.backlog_id },
        organization_id: org,
        rank,
        created_on: today(),
      });
      if (error) throw error;
      const { error: rankError } = await admin
        .from('work_item_backlog_ranks')
        .insert({ work_item_id: id, backlog_id: conn.backlog_id, rank, organization_id: org });
      if (rankError) console.error('jira-sync: could not rank a new item:', rankError.message);
      await writeHyperlinks(id, fields.hyperlinks);
      return id;
    },

    async updateItem(id, fields) {
      if (fields.hyperlinks !== undefined) await writeHyperlinks(id, fields.hyperlinks);
      const values: Record<string, unknown> = {};
      if (fields.title !== undefined) values.title = fields.title;
      if (fields.description !== undefined) values.description = fields.description || null;
      if (fields.status !== undefined) values.status = fields.status;
      if (fields.points !== undefined) values.points = fields.points;
      if (fields.parentId !== undefined) {
        // The parent in this tree: an override for the tree, if the item has one, would win over it.
        const { data } = await admin.from('work_items').select('parent_id_overrides').eq('id', id).maybeSingle();
        const overrides = { ...(data?.parent_id_overrides ?? {}) };
        delete overrides[tree];
        values.parent_id = fields.parentId;
        values.parent_id_overrides = overrides;
      }
      if (Object.keys(values).length === 0) return;
      const { error } = await admin.from('work_items').update(values).eq('id', id);
      if (error) throw error;
    },

    async deleteItem(id) {
      // Jira keeps an epic's stories when the epic goes; so do we.
      const { error: detachError } = await admin.from('work_items').update({ parent_id: null }).eq('parent_id', id);
      if (detachError) throw detachError;
      const { error } = await admin.from('work_items').delete().eq('id', id);
      if (error) throw error;
    },

    async links() {
      const { data, error } = await admin
        .from('jira_issue_links')
        .select('work_item_id, jira_issue_id, jira_key, jira_type, agreed, last_error')
        .eq('connection_id', conn.id);
      if (error) throw error;
      return (data ?? []).map((row: Record<string, unknown>) => ({
        workItemId: row.work_item_id as string,
        jiraId: row.jira_issue_id as string,
        jiraKey: row.jira_key as string,
        jiraType: row.jira_type as string,
        agreed: (row.agreed as SyncState | null) ?? null,
        error: (row.last_error as string | null) ?? null,
      }));
    },

    async saveLink(link: Link) {
      const { error } = await admin.from('jira_issue_links').upsert(
        {
          work_item_id: link.workItemId,
          connection_id: conn.id,
          organization_id: org,
          jira_issue_id: link.jiraId,
          jira_key: link.jiraKey,
          jira_type: link.jiraType,
          agreed: link.agreed,
          last_error: link.error ?? null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'connection_id,work_item_id' },
      );
      if (error) throw error;
    },

    async statuses() {
      const owner = await statusOwner();
      if (!owner) return [];
      const { data, error } = await admin.from('backlog_statuses').select('key, label').eq('backlog_id', owner);
      if (error) throw error;
      return (data ?? []) as { key: string; label: string }[];
    },

    async createStatus(label, category) {
      // Added where the list's statuses live: the list itself or the parent it inherits them from.
      const owner = (await statusOwner()) ?? conn.backlog_id;
      const { data: rows, error } = await admin.from('backlog_statuses').select('key, rank').eq('backlog_id', owner);
      if (error) throw error;
      const base = label.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'status';
      const taken = new Set((rows ?? []).map((r: { key: string }) => r.key));
      let key = `jira_${base}`;
      for (let n = 2; taken.has(key); n++) key = `jira_${base}_${n}`;
      const rank = Math.max(-1, ...(rows ?? []).map((r: { rank: number }) => r.rank)) + 1;
      const color = category === 'done' ? '#22c55e' : category === 'indeterminate' ? '#f97316' : '#94a3b8';
      const { error: insertError } = await admin.from('backlog_statuses').insert({ backlog_id: owner, key, label, color, rank });
      if (insertError) throw insertError;
      return key;
    },

    async dropLink(workItemId) {
      const { error } = await admin.from('jira_issue_links').delete().eq('connection_id', conn.id).eq('work_item_id', workItemId);
      if (error) throw error;
    },
  };
}

// ─── The queue ───────────────────────────────────────────────────────────────

async function withLock<T>(admin: Admin, connection: string, waitMs: number, work: () => Promise<T>): Promise<T | 'busy'> {
  const until = Date.now() + waitMs;
  for (;;) {
    const { data, error } = await admin.rpc('jira_try_lock_connection', { _connection: connection, _seconds: 120 });
    if (error) throw error;
    if (data === true) break;
    if (Date.now() >= until) return 'busy';
    // Short steps: a change queued while another drain runs starts as soon as it ends.
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  let result: T;
  try {
    result = await work();
  } finally {
    await admin.rpc('jira_unlock_connection', { _connection: connection });
  }
  // Something queued between the drain's last read and the unlock would otherwise wait for the minute job.
  const { count } = await admin
    .from('jira_sync_queue')
    .select('id', { count: 'exact', head: true })
    .eq('connection_id', connection)
    .is('done_at', null)
    .lt('attempts', 3);
  if ((count ?? 0) > 0) await withLock(admin, connection, 0, work);
  return result;
}

/** Work through what is queued for one space, oldest first, each item once. */
async function drain(admin: Admin, conn: Connection) {
  const jira = jiraPort(configFor(conn));
  const engine = new JiraSync(jira, agilefantPort(admin, conn));
  const started = Date.now();
  let processed = 0;
  let lastError: string | null = null;
  while (Date.now() - started < DRAIN_BUDGET_MS) {
    const { data: rows, error } = await admin
      .from('jira_sync_queue')
      .select('id, kind, ref, attempts')
      .eq('connection_id', conn.id)
      .is('done_at', null)
      .lt('attempts', 3)
      .order('id')
      .limit(DRAIN_BATCH);
    if (error) throw error;
    if (!rows || rows.length === 0) break;

    // The same item queued several times is synced once: it is read as it is now.
    const groups = new Map<string, number[]>();
    for (const row of rows) {
      const key = `${row.kind}:${row.ref ?? ''}`;
      groups.set(key, [...(groups.get(key) ?? []), row.id]);
    }
    // A full sync first; then Agilefant's changes before Jira's. Most of Jira's
    // are the echoes of what the sync itself just did there — a move in the
    // hierarchy sends one for every issue it retypes — and a person's next
    // change should not wait behind them. Safe either way: a field changed on
    // both sides goes to the later change, whichever is read first.
    const rank = (key: string) => (key.startsWith('full') || key.startsWith('levels') ? 0 : key.startsWith('item') ? 1 : 2);
    const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));
    for (const [key, ids] of ordered) {
      const [kind, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      try {
        if (kind === 'full') await engine.fullSync();
        else if (kind === 'links') await engine.syncHyperlinks();
        else if (kind === 'levels') {
          // Jira's hierarchy changed — a level added or taken away in its
          // settings, which no webhook announces: keep the new levels and
          // level every tree to them.
          const types = await jira.issueTypes();
          if (JSON.stringify(types) !== JSON.stringify(conn.issue_types)) {
            await admin.from('jira_connections').update({ issue_types: types }).eq('id', conn.id);
            conn.issue_types = types;
            await engine.fullSync();
          }
        }
        else if (kind === 'item') await engine.syncItem(ref);
        else if (kind === 'issue') await engine.syncIssue(ref);
        await admin.from('jira_sync_queue').update({ done_at: new Date().toISOString(), error: null }).in('id', ids);
      } catch (e) {
        lastError = e instanceof Error ? e.message : String(e);
        console.error(`jira-sync: ${kind} ${ref}:`, lastError);
        const attempts = (rows.find((r: { id: number }) => r.id === ids[0])?.attempts ?? 0) + 1;
        await admin.from('jira_sync_queue').update({ attempts, error: lastError.slice(0, 500) }).in('id', ids);
      }
      processed += ids.length;
    }
  }
  const report = engine.report;
  if (report.errors.length > 0) lastError = report.errors[report.errors.length - 1];
  // The project's levels, for the app to show the type a move will give an
  // item before Jira has made it. Read once per call, usually already read.
  const issueTypes = await jira.issueTypes().catch(() => null);
  const typesChanged = issueTypes && JSON.stringify(issueTypes) !== JSON.stringify(conn.issue_types);
  await admin
    .from('jira_connections')
    .update({
      last_synced_at: new Date().toISOString(),
      last_error: lastError,
      ...(typesChanged ? { issue_types: issueTypes } : {}),
    })
    .eq('id', conn.id);
  return { processed, report };
}

// ─── Who may do what ─────────────────────────────────────────────────────────

async function assertMember(admin: Admin, userId: string, org: string) {
  const { data } = await admin.from('memberships').select('role').eq('user_id', userId).eq('organization_id', org).maybeSingle();
  if (data) return data.role as string;
  const { data: profile } = await admin.from('profiles').select('is_superuser').eq('id', userId).maybeSingle();
  if (profile?.is_superuser) return 'superuser';
  throw new Error('forbidden: not a member of this organization');
}

async function assertManager(admin: Admin, userId: string, org: string) {
  const role = await assertMember(admin, userId, org);
  if (role !== 'owner' && role !== 'admin' && role !== 'superuser') throw new Error('forbidden: owners and admins only');
}

/** One space as the app shows it. */
async function spaceStatus(admin: Admin, conn: Connection) {
  const [{ count: linked }, { count: pending }, { data: failed }] = await Promise.all([
    admin.from('jira_issue_links').select('work_item_id', { count: 'exact', head: true }).eq('connection_id', conn.id),
    admin.from('jira_sync_queue').select('id', { count: 'exact', head: true }).eq('connection_id', conn.id).is('done_at', null),
    admin.from('jira_issue_links').select('jira_key, last_error').eq('connection_id', conn.id).not('last_error', 'is', null).limit(5),
  ]);
  return {
    id: conn.id,
    projectKey: conn.project_key,
    projectName: conn.project_name,
    treeId: conn.tree_id,
    backlogId: conn.backlog_id,
    pointsField: conn.points_field,
    webhook: !!conn.webhook_url,
    lastSyncedAt: conn.last_synced_at,
    lastError: conn.last_error,
    linked: linked ?? 0,
    pending: pending ?? 0,
    itemErrors: failed ?? [],
  };
}

/**
 * The organization's Jira: the site and account its spaces share, and each
 * space. The single-space fields (projectKey, backlogId, …) are the first
 * space's, and the counts the sum, for callers that knew only one.
 */
async function statusOf(admin: Admin, org: string) {
  const conns = await getConnections(admin, org);
  const tokenConfigured = !!Deno.env.get('JIRA_API_TOKEN');
  if (conns.length === 0) return { connected: false, tokenConfigured, spaces: [] };
  const spaces = await Promise.all(conns.map((c) => spaceStatus(admin, c)));
  const latest = spaces.map((s) => s.lastSyncedAt).filter(Boolean).sort().at(-1) ?? null;
  return {
    connected: true,
    tokenConfigured,
    baseUrl: conns[0].base_url,
    email: conns[0].email,
    spaces,
    projectKey: spaces[0].projectKey,
    treeId: spaces[0].treeId,
    backlogId: spaces[0].backlogId,
    pointsField: spaces[0].pointsField,
    webhook: spaces.every((s) => s.webhook),
    lastSyncedAt: latest,
    lastError: spaces.map((s) => s.lastError).find(Boolean) ?? null,
    linked: spaces.reduce((n, s) => n + s.linked, 0),
    pending: spaces.reduce((n, s) => n + s.pending, 0),
    itemErrors: spaces.flatMap((s) => s.itemErrors).slice(0, 5),
  };
}

/** Sum of several syncs' reports, for "Sync now" over all spaces. */
function addReports(reports: Array<Awaited<ReturnType<typeof drain>>['report']>) {
  const sum = { createdInAgilefant: 0, createdInJira: 0, updatedInAgilefant: 0, updatedInJira: 0, deletedInAgilefant: 0, deletedInJira: 0, skipped: [] as string[], errors: [] as string[] };
  for (const r of reports) {
    sum.createdInAgilefant += r.createdInAgilefant;
    sum.createdInJira += r.createdInJira;
    sum.updatedInAgilefant += r.updatedInAgilefant;
    sum.updatedInJira += r.updatedInJira;
    sum.deletedInAgilefant += r.deletedInAgilefant;
    sum.deletedInJira += r.deletedInJira;
    sum.skipped.push(...r.skipped);
    sum.errors.push(...r.errors);
  }
  return sum;
}

/** The Jira site and account an organization's spaces share, or the ones given for its first. */
function accountFrom(body: Record<string, unknown>, existing: Connection | undefined) {
  const baseUrl = String(body.baseUrl ?? existing?.base_url ?? '').trim().replace(/\/+$/, '');
  const email = String(body.email ?? existing?.email ?? '').trim();
  if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i.test(baseUrl)) throw new Error('bad_request: The Jira address must look like https://yoursite.atlassian.net');
  if (!email.includes('@')) throw new Error("bad_request: The Atlassian account's email is needed");
  if (existing && existing.base_url !== baseUrl) {
    throw new Error('bad_request: The spaces kept in step are on another Jira site; take them off first to change the site');
  }
  return { baseUrl, email };
}

// ─── The handler ─────────────────────────────────────────────────────────────

declare const EdgeRuntime: { waitUntil(promise: Promise<unknown>): void } | undefined;
function inBackground(work: Promise<unknown>) {
  if (typeof EdgeRuntime !== 'undefined') EdgeRuntime.waitUntil(work);
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders });
  const admin = adminClient();
  const url = new URL(req.url);

  try {
    // Jira's webhook: the secret in its address names the connection.
    if (url.searchParams.get('action') === 'webhook') {
      const secret = url.searchParams.get('secret') ?? '';
      const { data: conn } = await admin.from('jira_connections').select('*').eq('webhook_secret', secret).maybeSingle();
      if (!secret || !conn) return json({ error: 'unknown webhook' }, 404);
      const event = await req.json().catch(() => ({}));
      const issueId = event?.issue?.id ? String(event.issue.id) : null;
      if (!issueId) return json({ ignored: true });
      await admin.from('jira_sync_queue').insert({ organization_id: conn.organization_id, connection_id: conn.id, kind: 'issue', ref: issueId });
      // Answer Jira at once; the work goes on after.
      inBackground(withLock(admin, conn.id, 30_000, () => drain(admin, conn as Connection)).catch((e) => console.error('jira-sync webhook drain:', e)));
      return json({ queued: issueId });
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? 'status');
    const org = String(body.organizationId ?? '');
    if (!org) return json({ error: 'organizationId is required' }, 400);

    // The database's "there is work queued": it can only start what is already queued.
    if (action === 'drain') {
      const wanted = body.connectionId ? [await getConnection(admin, org, String(body.connectionId))] : await getConnections(admin, org);
      let processed = 0;
      for (const conn of wanted) {
        if (!conn || !conn.enabled) continue;
        const result = await withLock(admin, conn.id, 0, () => drain(admin, conn));
        if (result !== 'busy') processed += result.processed;
      }
      return json({ processed });
    }

    const user = await requireAppUser(req);

    if (action === 'status') {
      await assertMember(admin, user.id, org);
      return json(await statusOf(admin, org));
    }

    // The site's spaces, to choose from: with the account the organization's spaces use, or the one given.
    if (action === 'projects') {
      await assertManager(admin, user.id, org);
      const existing = (await getConnections(admin, org))[0];
      const { baseUrl, email } = accountFrom(body, existing);
      const probe = jiraPort({ baseUrl, email, token: token(), projectKey: '', pointsField: null });
      await probe.myself();
      return json({ projects: await probe.listProjects() });
    }

    // A space kept in step with a list: one there is, or one made for it in the tree given.
    if (action === 'addSpace') {
      await assertManager(admin, user.id, org);
      const existing = await getConnections(admin, org);
      const { baseUrl, email } = accountFrom(body, existing[0]);
      const projectKey = String(body.projectKey ?? '').trim().toUpperCase();
      if (!projectKey) return json({ error: 'projectKey is required' }, 400);
      if (existing.some((c) => c.project_key === projectKey)) return json({ error: `${projectKey} is already kept in step` }, 409);

      // The space and the token first, before anything is made.
      const probe = jiraPort({ baseUrl, email, token: token(), projectKey, pointsField: null });
      await probe.myself();
      const project = await probe.project();
      const pointsField = await probe.findPointsField();

      let backlogId = String(body.backlogId ?? '');
      let treeId: string;
      if (backlogId) {
        const { data: backlog } = await admin.from('backlogs').select('id, tree_id, organization_id').eq('id', backlogId).maybeSingle();
        if (!backlog || backlog.organization_id !== org) return json({ error: 'That list is not in this organization' }, 400);
        if (existing.some((c) => c.backlog_id === backlogId)) return json({ error: 'That list is already kept in step with a space' }, 409);
        treeId = backlog.tree_id;
      } else {
        // A new list, named after the space, last among the tree's top-level lists.
        treeId = String(body.newListTreeId ?? '');
        const { data: tree } = await admin.from('backlog_trees').select('id, organization_id').eq('id', treeId).maybeSingle();
        if (!tree || tree.organization_id !== org) return json({ error: 'Choose a tree of this organization for the new list' }, 400);
        const { data: last } = await admin
          .from('backlogs')
          .select('rank')
          .eq('tree_id', treeId)
          .is('parent_id', null)
          .order('rank', { ascending: false })
          .limit(1);
        backlogId = `${org}::bl-${crypto.randomUUID().slice(0, 8)}`;
        const { error: listError } = await admin.from('backlogs').insert({
          id: backlogId,
          name: project.name,
          parent_id: null,
          tree_id: treeId,
          rank: (last?.[0]?.rank ?? -1) + 1,
          organization_id: org,
        });
        if (listError) throw listError;
      }

      const functionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/jira-sync`;
      const { data: inserted, error } = await admin
        .from('jira_connections')
        .insert({
          organization_id: org,
          base_url: baseUrl,
          email,
          project_key: project.key,
          project_name: project.name,
          project_id: project.id,
          tree_id: treeId,
          backlog_id: backlogId,
          points_field: pointsField,
          enabled: true,
          function_url: functionUrl,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        })
        .select('*')
        .single();
      if (error) throw error;
      const conn = inserted as Connection;

      // Its own webhook: Jira's changes to this space come to this connection.
      let webhookError: string | null = null;
      try {
        const self = await jiraPort(configFor(conn)).registerWebhook(`${functionUrl}?action=webhook&secret=${conn.webhook_secret}`);
        await admin.from('jira_connections').update({ webhook_url: self }).eq('id', conn.id);
      } catch (e) {
        webhookError = e instanceof Error ? e.message : String(e);
        await admin.from('jira_connections').update({ webhook_url: null, last_error: `Webhook: ${webhookError}` }).eq('id', conn.id);
      }

      // The first sync, before answering: the space's issues come in, the list's
      // items go out. Done after the answer, it raced the app's reload of its
      // data, which could finish with a copy read before the items were made —
      // a new list that looked empty until the page was loaded again.
      await admin.from('jira_sync_queue').insert({ organization_id: org, connection_id: conn.id, kind: 'full', ref: null });
      const first = await withLock(admin, conn.id, 30_000, () => drain(admin, conn));
      return json({ ...(await statusOf(admin, org)), added: conn.id, webhookError, report: first === 'busy' ? undefined : first.report });
    }

    // A space taken off: its sync stops and its pairs are forgotten; the list and the issues stay.
    if (action === 'removeSpace') {
      await assertManager(admin, user.id, org);
      const conn = await getConnection(admin, org, String(body.connectionId ?? ''));
      if (!conn) return json({ error: 'No such space here' }, 404);
      if (conn.webhook_url) await jiraPort(configFor(conn)).removeWebhook(conn.webhook_url).catch(() => undefined);
      // Its pairs and queue go with it (ON DELETE CASCADE).
      await admin.from('jira_connections').delete().eq('id', conn.id);
      return json(await statusOf(admin, org));
    }

    // Everything, both ways: one space, or every space of the organization.
    if (action === 'sync') {
      await assertMember(admin, user.id, org);
      const wanted = body.connectionId ? [await getConnection(admin, org, String(body.connectionId))] : await getConnections(admin, org);
      const conns = wanted.filter((c): c is Connection => !!c);
      if (conns.length === 0) return json({ error: 'Jira is not connected' }, 409);
      const reports = [];
      for (const conn of conns) {
        await admin.from('jira_sync_queue').insert({ organization_id: org, connection_id: conn.id, kind: 'full', ref: null });
        const result = await withLock(admin, conn.id, 30_000, () => drain(admin, conn));
        if (result === 'busy') return json({ error: `A sync of ${conn.project_key} is already running. Try again in a minute.` }, 409);
        reports.push(result.report);
      }
      return json({ ...(await statusOf(admin, org)), report: addReports(reports) });
    }

    // Every space taken off.
    if (action === 'disconnect') {
      await assertManager(admin, user.id, org);
      for (const conn of await getConnections(admin, org)) {
        if (conn.webhook_url) await jiraPort(configFor(conn)).removeWebhook(conn.webhook_url).catch(() => undefined);
        await admin.from('jira_connections').delete().eq('id', conn.id);
      }
      return json({ connected: false, tokenConfigured: !!Deno.env.get('JIRA_API_TOKEN'), spaces: [] });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('jira-sync error:', message);
    if (message.startsWith('unauthorized')) return json({ error: 'unauthorized' }, 401);
    if (message.startsWith('forbidden')) return json({ error: message }, 403);
    if (message.startsWith('bad_request: ')) return json({ error: message.slice('bad_request: '.length) }, 400);
    if (message === 'jira_token_missing') {
      return json({ error: 'The JIRA_API_TOKEN secret is not set for the edge functions.' }, 409);
    }
    if (e instanceof JiraError) return json({ error: e.message }, 502);
    return json({ error: message }, 500);
  }
});
