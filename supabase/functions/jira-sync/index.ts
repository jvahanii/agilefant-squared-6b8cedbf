// Agilefant ↔ Jira Cloud: one list kept in step with one project, both ways.
//
// Who calls this:
//   the app        status · configure · sync (now) · disconnect — signed in, an
//                  owner or admin for anything that changes the connection
//   the database   drain — a trigger queued changed items (no sign-in: all it
//                  can do is work through what is already queued)
//   Jira           webhook — an issue changed; the URL carries the connection's
//                  secret
//
// The rules of what stands for what are in _shared/jiraMapping.ts and the
// order of doing things in _shared/jiraEngine.ts. This file is the wiring:
// the real Jira, the real database, the queue and its lock.

import { adminClient, corsHeaders, json } from '../_shared/gmail.ts';
import { requireAppUser } from '../_shared/auth.ts';
import { jiraPort, JiraError, type JiraConfig } from '../_shared/jiraApi.ts';
import { JiraSync, type AgilefantItem, type AgilefantPort, type Link } from '../_shared/jiraEngine.ts';
import type { SyncState } from '../_shared/jiraMapping.ts';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Admin = any;

interface Connection {
  organization_id: string;
  base_url: string;
  email: string;
  project_key: string;
  project_id: string | null;
  tree_id: string;
  backlog_id: string;
  points_field: string | null;
  enabled: boolean;
  webhook_secret: string;
  webhook_url: string | null;
  last_synced_at: string | null;
  last_error: string | null;
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

async function getConnection(admin: Admin, organizationId: string): Promise<Connection | null> {
  const { data, error } = await admin.from('jira_connections').select('*').eq('organization_id', organizationId).maybeSingle();
  if (error) throw error;
  return data as Connection | null;
}

// ─── Agilefant, as the engine sees it ────────────────────────────────────────

function agilefantPort(admin: Admin, conn: Connection): AgilefantPort {
  const org = conn.organization_id;
  const tree = conn.tree_id;
  const today = () => new Date().toISOString().slice(0, 10);

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
      const { data, error } = await admin.rpc('jira_list_items', { _org: org });
      if (error) throw error;
      const rows = (data ?? []) as Array<Parameters<typeof asItem>[0]>;
      const ids = new Set(rows.map((r) => r.id));
      return rows.map((r) => asItem(r, true, !!r.parent_id && ids.has(r.parent_id)));
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
      return asItem({ ...data, parent_id: parentId }, inList, parentInList);
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
      return id;
    },

    async updateItem(id, fields) {
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
        .eq('organization_id', org);
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
          organization_id: org,
          jira_issue_id: link.jiraId,
          jira_key: link.jiraKey,
          jira_type: link.jiraType,
          agreed: link.agreed,
          last_error: link.error ?? null,
          synced_at: new Date().toISOString(),
        },
        { onConflict: 'work_item_id' },
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
      const { error } = await admin.from('jira_issue_links').delete().eq('work_item_id', workItemId);
      if (error) throw error;
    },
  };
}

// ─── The queue ───────────────────────────────────────────────────────────────

async function withLock<T>(admin: Admin, org: string, waitMs: number, work: () => Promise<T>): Promise<T | 'busy'> {
  const until = Date.now() + waitMs;
  for (;;) {
    const { data, error } = await admin.rpc('jira_try_lock', { _org: org, _seconds: 120 });
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
    await admin.rpc('jira_unlock', { _org: org });
  }
  // Something queued between the drain's last read and the unlock would otherwise wait for the minute job.
  const { count } = await admin
    .from('jira_sync_queue')
    .select('id', { count: 'exact', head: true })
    .eq('organization_id', org)
    .is('done_at', null)
    .lt('attempts', 3);
  if ((count ?? 0) > 0) await withLock(admin, org, 0, work);
  return result;
}

/** Work through what is queued for one organization, oldest first, each item once. */
async function drain(admin: Admin, conn: Connection) {
  const engine = new JiraSync(jiraPort(configFor(conn)), agilefantPort(admin, conn));
  const started = Date.now();
  let processed = 0;
  let lastError: string | null = null;
  while (Date.now() - started < DRAIN_BUDGET_MS) {
    const { data: rows, error } = await admin
      .from('jira_sync_queue')
      .select('id, kind, ref, attempts')
      .eq('organization_id', conn.organization_id)
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
    const rank = (key: string) => (key.startsWith('full') ? 0 : key.startsWith('item') ? 1 : 2);
    const ordered = [...groups.entries()].sort(([a], [b]) => rank(a) - rank(b));
    for (const [key, ids] of ordered) {
      const [kind, ref] = [key.slice(0, key.indexOf(':')), key.slice(key.indexOf(':') + 1)];
      try {
        if (kind === 'full') await engine.fullSync();
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
  await admin
    .from('jira_connections')
    .update({ last_synced_at: new Date().toISOString(), last_error: lastError })
    .eq('organization_id', conn.organization_id);
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

async function statusOf(admin: Admin, org: string) {
  const conn = await getConnection(admin, org);
  const tokenConfigured = !!Deno.env.get('JIRA_API_TOKEN');
  if (!conn) return { connected: false, tokenConfigured };
  const [{ count: linked }, { count: pending }, { data: failed }] = await Promise.all([
    admin.from('jira_issue_links').select('work_item_id', { count: 'exact', head: true }).eq('organization_id', org),
    admin.from('jira_sync_queue').select('id', { count: 'exact', head: true }).eq('organization_id', org).is('done_at', null),
    admin.from('jira_issue_links').select('jira_key, last_error').eq('organization_id', org).not('last_error', 'is', null).limit(5),
  ]);
  return {
    connected: true,
    tokenConfigured,
    baseUrl: conn.base_url,
    email: conn.email,
    projectKey: conn.project_key,
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
      await admin.from('jira_sync_queue').insert({ organization_id: conn.organization_id, kind: 'issue', ref: issueId });
      // Answer Jira at once; the work goes on after.
      inBackground(withLock(admin, conn.organization_id, 30_000, () => drain(admin, conn as Connection)).catch((e) => console.error('jira-sync webhook drain:', e)));
      return json({ queued: issueId });
    }

    const body = req.method === 'POST' ? await req.json().catch(() => ({})) : {};
    const action = String(body.action ?? 'status');
    const org = String(body.organizationId ?? '');
    if (!org) return json({ error: 'organizationId is required' }, 400);

    // The database's "there is work queued": it can only start what is already queued.
    if (action === 'drain') {
      const conn = await getConnection(admin, org);
      if (!conn || !conn.enabled) return json({ skipped: true });
      const result = await withLock(admin, org, 0, () => drain(admin, conn));
      return json(result === 'busy' ? { busy: true } : { processed: result.processed });
    }

    const user = await requireAppUser(req);

    if (action === 'status') {
      await assertMember(admin, user.id, org);
      return json(await statusOf(admin, org));
    }

    if (action === 'configure') {
      await assertManager(admin, user.id, org);
      const baseUrl = String(body.baseUrl ?? '').trim().replace(/\/+$/, '');
      const email = String(body.email ?? '').trim();
      const projectKey = String(body.projectKey ?? '').trim().toUpperCase();
      const backlogId = String(body.backlogId ?? '');
      if (!/^https:\/\/[a-z0-9-]+\.atlassian\.net$/i.test(baseUrl)) return json({ error: 'The Jira address must look like https://yoursite.atlassian.net' }, 400);
      if (!email.includes('@') || !projectKey || !backlogId) return json({ error: 'email, projectKey and backlogId are required' }, 400);
      const { data: backlog } = await admin.from('backlogs').select('id, tree_id, organization_id').eq('id', backlogId).maybeSingle();
      if (!backlog || backlog.organization_id !== org) return json({ error: 'That list is not in this organization' }, 400);

      // Check the token and the project before keeping anything.
      const probe = jiraPort({ baseUrl, email, token: token(), projectKey, pointsField: null });
      await probe.myself();
      const project = await probe.project();
      const pointsField = await probe.findPointsField();

      const previous = await getConnection(admin, org);
      const functionUrl = `${Deno.env.get('SUPABASE_URL')}/functions/v1/jira-sync`;
      const { error } = await admin.from('jira_connections').upsert(
        {
          organization_id: org,
          base_url: baseUrl,
          email,
          project_key: project.key,
          project_id: project.id,
          tree_id: backlog.tree_id,
          backlog_id: backlogId,
          points_field: pointsField,
          enabled: true,
          function_url: functionUrl,
          created_by: user.id,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'organization_id' },
      );
      if (error) throw error;
      const conn = (await getConnection(admin, org))!;

      // Jira's webhook, made afresh; the old one, if any, removed.
      const port = jiraPort(configFor(conn));
      let webhookError: string | null = null;
      if (previous?.webhook_url) await port.removeWebhook(previous.webhook_url).catch(() => undefined);
      try {
        const self = await port.registerWebhook(`${functionUrl}?action=webhook&secret=${conn.webhook_secret}`);
        await admin.from('jira_connections').update({ webhook_url: self }).eq('organization_id', org);
      } catch (e) {
        webhookError = e instanceof Error ? e.message : String(e);
        await admin.from('jira_connections').update({ webhook_url: null, last_error: `Webhook: ${webhookError}` }).eq('organization_id', org);
      }
      // A connection to another list starts its pairs afresh.
      if (previous && (previous.backlog_id !== backlogId || previous.project_key !== project.key)) {
        await admin.from('jira_issue_links').delete().eq('organization_id', org);
      }
      return json({ ...(await statusOf(admin, org)), webhookError });
    }

    if (action === 'sync') {
      await assertMember(admin, user.id, org);
      const conn = await getConnection(admin, org);
      if (!conn) return json({ error: 'Jira is not connected' }, 409);
      await admin.from('jira_sync_queue').insert({ organization_id: org, kind: 'full', ref: null });
      const result = await withLock(admin, org, 30_000, () => drain(admin, conn));
      if (result === 'busy') return json({ error: 'A sync is already running. Try again in a minute.' }, 409);
      return json({ ...(await statusOf(admin, org)), report: result.report });
    }

    if (action === 'disconnect') {
      await assertManager(admin, user.id, org);
      const conn = await getConnection(admin, org);
      if (conn?.webhook_url) await jiraPort(configFor(conn)).removeWebhook(conn.webhook_url).catch(() => undefined);
      await admin.from('jira_issue_links').delete().eq('organization_id', org);
      await admin.from('jira_sync_queue').delete().eq('organization_id', org);
      await admin.from('jira_connections').delete().eq('organization_id', org);
      return json({ connected: false });
    }

    return json({ error: `unknown action: ${action}` }, 400);
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    console.error('jira-sync error:', message);
    if (message.startsWith('unauthorized')) return json({ error: 'unauthorized' }, 401);
    if (message.startsWith('forbidden')) return json({ error: message }, 403);
    if (message === 'jira_token_missing') {
      return json({ error: 'The JIRA_API_TOKEN secret is not set for the edge functions.' }, 409);
    }
    if (e instanceof JiraError) return json({ error: e.message }, 502);
    return json({ error: message }, 500);
  }
});
