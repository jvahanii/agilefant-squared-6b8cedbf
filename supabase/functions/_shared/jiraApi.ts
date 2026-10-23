// Jira Cloud's REST API, as much of it as the sync uses.
//
// Signs in as one person with an API token (Basic auth: email + token). The
// token is the JIRA_API_TOKEN secret of the edge functions — it is never
// stored in a table or seen by the app.
//
// Takes its fetch as an argument so it can be tested without a network.

import { adfToText, textToAdf, toPoints, toSummary, normalizeHyperlinks, type SyncState, type SyncedField } from './jiraMapping.ts';
import type { JiraIssue, JiraPort } from './jiraEngine.ts';

export interface JiraConfig {
  /** https://example.atlassian.net, no trailing slash. */
  baseUrl: string;
  email: string;
  token: string;
  projectKey: string;
  /** The custom field that holds story points, e.g. customfield_10016; null when the project has none. */
  pointsField: string | null;
}

type Fetcher = (url: string, init: RequestInit) => Promise<Response>;

export class JiraError extends Error {
  constructor(
    readonly status: number,
    readonly body: string,
  ) {
    super(`Jira answered ${status}: ${JiraError.readable(body)}`);
  }

  /** Jira's own words from an error body, which is JSON with errorMessages and errors. */
  static readable(body: string): string {
    try {
      const parsed = JSON.parse(body) as { errorMessages?: unknown[]; errors?: Record<string, unknown>; message?: string };
      // The bulk move answers with objects where other calls have strings.
      const text = (v: unknown) => (typeof v === "string" ? v : JSON.stringify(v));
      const parts = [...(parsed.errorMessages ?? []).map(text), ...Object.entries(parsed.errors ?? {}).map(([k, v]) => `${k}: ${text(v)}`)];
      if (parsed.message) parts.push(parsed.message);
      if (parts.length > 0) return parts.join('; ').slice(0, 400);
    } catch {
      // Not JSON.
    }
    return body.slice(0, 400);
  }
}

/** Per request: long enough for a slow Jira, short enough not to stall a sync. */
const TIMEOUT_MS = 20_000;

export function jiraRequester(config: JiraConfig, fetcher: Fetcher = (url, init) => fetch(url, init)) {
  const auth = `Basic ${btoa(`${config.email}:${config.token}`)}`;
  return async function call<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetcher(`${config.baseUrl}${path}`, {
      method: init.method ?? 'GET',
      headers: { Authorization: auth, Accept: 'application/json', 'Content-Type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new JiraError(res.status, await res.text().catch(() => ''));
    if (res.status === 204) return undefined as T;
    const text = await res.text();
    return (text ? JSON.parse(text) : undefined) as T;
  };
}

type RawIssue = {
  id: string;
  key: string;
  fields: {
    summary?: string;
    description?: unknown;
    status?: { name: string; statusCategory?: { key: string } };
    issuetype?: { name: string };
    parent?: { id: string } | null;
    updated?: string;
    [field: string]: unknown;
  };
};

export function jiraPort(config: JiraConfig, fetcher?: Fetcher): JiraPort & {
  myself(): Promise<{ accountId: string; displayName: string; emailAddress?: string }>;
  project(): Promise<{ id: string; key: string; name: string }>;
  listProjects(): Promise<Array<{ id: string; key: string; name: string; style: string | null }>>;
  findPointsField(): Promise<string | null>;
  registerWebhook(url: string): Promise<string>;
  removeWebhook(self: string): Promise<void>;
  changeType(id: string, type: string, parent: string | null): Promise<void>;
} {
  const call = jiraRequester(config, fetcher);
  const fields = ['summary', 'description', 'status', 'issuetype', 'parent', 'updated', ...(config.pointsField ? [config.pointsField] : [])];

  type RemoteLink = { id: number; globalId?: string; application?: { type?: string; name?: string }; object?: { url?: string; title?: string } };
  const external = (link: RemoteLink) => !link.application?.type && !link.application?.name;
  const remoteLinks = (id: string) => call<RemoteLink[]>(`/rest/api/3/issue/${encodeURIComponent(id)}/remotelink`);
  const withLinks = async (raw: RawIssue): Promise<JiraIssue> => {
    const issue = toIssue(raw);
    issue.state.hyperlinks = normalizeHyperlinks((await remoteLinks(raw.id)).filter(external).map((l) => l.object));
    return issue;
  };
  const writeLinks = async (id: string, state: SyncState) => {
    const current = (await remoteLinks(id)).filter(external);
    const wanted = normalizeHyperlinks(state.hyperlinks);
    const kept = new Set<string>();
    for (const link of current) {
      const target = wanted.find((l) => l.url === link.object?.url);
      const path = `/rest/api/3/issue/${encodeURIComponent(id)}/remotelink/${link.id}`;
      if (!target || kept.has(target.url)) {
        // Invalid/non-web remote links are not ours to remove.
        if (normalizeHyperlinks([link.object]).length) await call(path, { method: 'DELETE' });
      } else {
        kept.add(target.url);
        if ((link.object?.title || link.object?.url) !== target.title) {
          await call(path, { method: 'PUT', body: { object: { ...link.object, ...target } } });
        }
      }
    }
    for (const target of wanted) {
      if (!kept.has(target.url)) await call(`/rest/api/3/issue/${encodeURIComponent(id)}/remotelink`, {
        method: 'POST', body: { globalId: `agilefant:web:${target.url}`, object: target },
      });
    }
  };

  const toIssue = (raw: RawIssue): JiraIssue => ({
    id: raw.id,
    key: raw.key,
    type: raw.fields.issuetype?.name ?? 'Task',
    statusCategory: raw.fields.status?.statusCategory?.key ?? null,
    updatedAt: raw.fields.updated ? Date.parse(raw.fields.updated) : 0,
    state: {
      title: toSummary(raw.fields.summary ?? ''),
      description: adfToText(raw.fields.description),
      status: raw.fields.status?.name ?? 'To Do',
      points: config.pointsField ? toPoints(raw.fields[config.pointsField]) : null,
      parent: raw.fields.parent?.id ?? null,
    },
  });

  /** Move the issue to the status by name, through whichever transition gets there. */
  const transitionTo = async (id: string, status: string) => {
    const { transitions } = await call<{ transitions: Array<{ id: string; to: { name: string } }> }>(
      `/rest/api/3/issue/${id}/transitions`,
    );
    const transition = transitions.find((t) => t.to.name === status);
    if (!transition) throw new Error(`no transition to "${status}"`);
    await call(`/rest/api/3/issue/${id}/transitions`, { method: 'POST', body: { transition: { id: transition.id } } });
  };

  // The project's statuses by lower-cased name → Jira's own spelling, read once per call of the function.
  let knownStatuses: Map<string, string> | null = null;
  const projectStatuses = async () => {
    if (knownStatuses) return knownStatuses;
    const types = await call<Array<{ id: string; statuses: Array<{ name: string }> }>>(`/rest/api/3/project/${config.projectKey}/statuses`);
    knownStatuses = new Map(types.flatMap((t) => t.statuses.map((st) => [st.name.trim().toLowerCase(), st.name] as [string, string])));
    return knownStatuses;
  };

  /**
   * Add a status to the project's workflows, reachable from every status (a
   * global transition). Needs the project's admin permission; throws when Jira refuses.
   */
  const addStatusToWorkflows = async (name: string) => {
    const project = await call<{ id: string }>(`/rest/api/3/project/${config.projectKey}`);
    const types = await call<Array<{ id: string }>>(`/rest/api/3/project/${config.projectKey}/statuses`);
    type Workflow = {
      id: string;
      version: unknown;
      description?: string;
      statuses: Array<Record<string, unknown>>;
      transitions: Array<{ id: string } & Record<string, unknown>>;
      startPointLayout?: unknown;
      loopedTransitionContainerLayout?: unknown;
      scope?: unknown;
    };
    const read = await call<{ workflows: Workflow[]; statuses: Array<Record<string, unknown>> }>('/rest/api/3/workflows', {
      method: 'POST',
      body: { projectAndIssueTypes: types.map((t) => ({ projectId: project.id, issueTypeId: t.id })) },
    });
    if (!read.workflows?.length) throw new Error('found no workflow to add it to');
    const ref = crypto.randomUUID();
    const scope = read.workflows[0].scope ?? { type: 'GLOBAL' };
    await call('/rest/api/3/workflows/update', {
      method: 'POST',
      body: {
        statuses: [...read.statuses, { name, statusCategory: 'IN_PROGRESS', statusReference: ref, scope }],
        workflows: read.workflows.map((w) => ({
          id: w.id,
          version: w.version,
          description: w.description,
          startPointLayout: w.startPointLayout,
          loopedTransitionContainerLayout: w.loopedTransitionContainerLayout,
          statuses: [...w.statuses, { statusReference: ref, properties: {} }],
          transitions: [
            ...w.transitions,
            {
              id: String(Math.max(0, ...w.transitions.map((t) => Number(t.id) || 0)) + 1),
              name,
              toStatusReference: ref,
              type: 'GLOBAL',
              links: [],
              properties: {},
            },
          ],
        })),
      },
    });
    knownStatuses = null;
  };

  /** Edit fields; a points field the screen will not take is left out rather than failing the rest. */
  const edit = async (id: string, values: Record<string, unknown>) => {
    if (Object.keys(values).length === 0) return;
    try {
      await call(`/rest/api/3/issue/${id}`, { method: 'PUT', body: { fields: values } });
    } catch (e) {
      if (config.pointsField && e instanceof JiraError && e.body.includes(config.pointsField) && config.pointsField in values) {
        const { [config.pointsField]: _skipped, ...rest } = values;
        if (Object.keys(rest).length > 0) await call(`/rest/api/3/issue/${id}`, { method: 'PUT', body: { fields: rest } });
        return;
      }
      throw e;
    }
  };

  const fieldValues = (names: SyncedField[], state: SyncState): Record<string, unknown> => {
    const values: Record<string, unknown> = {};
    for (const name of names) {
      if (name === 'title') values.summary = state.title;
      if (name === 'description') values.description = textToAdf(state.description);
      if (name === 'points' && config.pointsField) values[config.pointsField] = state.points;
      if (name === 'parent') values.parent = state.parent ? { id: state.parent } : null;
    }
    return values;
  };

  // The project's issue types, read once: a move names its target type by
  // id, and their levels are the hierarchy the sync fits Agilefant's into.
  type ProjectType = { id: string; name: string; hierarchyLevel: number };
  let projectTypes: Promise<ProjectType[]> | null = null;
  const readTypes = () =>
    (projectTypes ??= call<{ issueTypes: ProjectType[] }>(`/rest/api/3/project/${encodeURIComponent(config.projectKey)}`).then(
      (p) => p.issueTypes,
    ));
  const typeNamed = async (name: string) => {
    const found = (await readTypes()).find((t) => t.name === name);
    if (!found) throw new Error(`the project has no issue type "${name}"`);
    return found;
  };

  return {
    /**
     * Jira's bulk move, for one issue: the only way to turn a task into a
     * subtask or back. It runs as a task, which is waited for.
     */
    async changeType(id, type, parent) {
      // Jira takes the parent in the target only for a subtask; any other is given one by an edit after.
      const target = await typeNamed(type);
      const key = [config.projectKey, target.id, ...(target.hierarchyLevel === -1 && parent ? [parent] : [])].join(',');
      const { taskId } = await call<{ taskId: string }>('/rest/api/3/bulk/issues/move', {
        method: 'POST',
        body: {
          sendBulkNotification: false,
          targetToSourcesMapping: {
            [key]: {
              issueIdsOrKeys: [id],
              inferFieldDefaults: true,
              inferStatusDefaults: true,
              inferClassificationDefaults: true,
              inferSubtaskTypeDefault: true,
            },
          },
        },
      });
      // Jira's move of one issue usually ends within a second or two: asked
      // soon and then less often, about thirty seconds in all.
      for (let attempt = 0; attempt < 40; attempt++) {
        await new Promise((resolve) => setTimeout(resolve, Math.min(300 + attempt * 200, 1_000)));
        const progress = await call<{ status: string; failedAccessibleIssues?: Record<string, string[]> }>(
          `/rest/api/3/bulk/queue/${taskId}`,
        );
        const failed = Object.values(progress.failedAccessibleIssues ?? {}).flat();
        if (failed.length > 0) throw new Error(`Jira could not make it a ${type}: ${failed.join('; ')}`);
        if (progress.status === 'COMPLETE') return;
        if (['FAILED', 'CANCELLED', 'DEAD'].includes(progress.status)) {
          throw new Error(`Jira could not make it a ${type} (move ${progress.status.toLowerCase()})`);
        }
      }
      throw new Error(`Jira did not finish making it a ${type} in time`);
    },

    async issueTypes() {
      return (await readTypes()).map((t) => ({ name: t.name, level: t.hierarchyLevel }));
    },

    async listIssues() {
      const out: JiraIssue[] = [];
      let nextPageToken: string | undefined;
      for (let page = 0; page < 50; page++) {
        const result = await call<{ issues: RawIssue[]; nextPageToken?: string }>('/rest/api/3/search/jql', {
          method: 'POST',
          body: { jql: `project = "${config.projectKey}" ORDER BY key`, fields, maxResults: 100, nextPageToken },
        });
        // Bound concurrent requests instead of sending one burst for a large project.
        for (let start = 0; start < result.issues.length; start += 5) {
          out.push(...await Promise.all(result.issues.slice(start, start + 5).map(withLinks)));
        }
        if (!result.nextPageToken) break;
        nextPageToken = result.nextPageToken;
      }
      return out;
    },

    async getIssue(id) {
      let raw: RawIssue;
      try {
        raw = await call<RawIssue>(`/rest/api/3/issue/${id}?fields=${fields.join(',')}`);
      } catch (e) {
        if (e instanceof JiraError && e.status === 404) return null;
        throw e;
      }
      return await withLinks(raw);
    },

    async createIssue(type, state) {
      const values: Record<string, unknown> = {
        project: { key: config.projectKey },
        issuetype: { name: type },
        summary: state.title,
      };
      const description = textToAdf(state.description);
      if (description) values.description = description;
      if (state.parent) values.parent = { id: state.parent };
      if (config.pointsField && state.points !== null) values[config.pointsField] = state.points;
      let created: { id: string; key: string };
      try {
        created = await call('/rest/api/3/issue', { method: 'POST', body: { fields: values } });
      } catch (e) {
        // Epics in a team-managed project take no story points: create without.
        if (config.pointsField && e instanceof JiraError && e.body.includes(config.pointsField)) {
          delete values[config.pointsField];
          created = await call('/rest/api/3/issue', { method: 'POST', body: { fields: values } });
        } else {
          throw e;
        }
      }
      if (state.status !== 'To Do') await transitionTo(created.id, state.status);
      return { id: created.id, key: created.key };
    },

    async ensureStatus(name) {
      const found = (await projectStatuses()).get(name.trim().toLowerCase());
      if (found) return found;
      await addStatusToWorkflows(name.trim());
      return (await projectStatuses()).get(name.trim().toLowerCase()) ?? name.trim();
    },

    async updateIssue(id, names, state) {
      await edit(id, fieldValues(names.filter((n) => n !== 'status'), state));
      if (names.includes('status')) await transitionTo(id, state.status);
      if (names.includes('hyperlinks')) await writeLinks(id, state);
    },

    async deleteIssue(id) {
      try {
        await call(`/rest/api/3/issue/${id}?deleteSubtasks=true`, { method: 'DELETE' });
      } catch (e) {
        if (e instanceof JiraError && e.status === 404) return;
        // In a company-managed project only its administrators may delete by default.
        if (e instanceof JiraError && e.status === 403) {
          throw new Error(
            'Jira did not allow deleting it: the Jira account the sync uses needs the "Delete work items" permission in this project',
          );
        }
        throw e;
      }
    },

    myself: () => call('/rest/api/3/myself'),
    project: () => call(`/rest/api/3/project/${encodeURIComponent(config.projectKey)}`),

    /** The site's spaces the account can see, by name: what may be chosen to keep in step. */
    async listProjects() {
      const out: Array<{ id: string; key: string; name: string; style: string | null }> = [];
      let startAt = 0;
      for (let page = 0; page < 20; page++) {
        const result = await call<{ values: Array<{ id: string; key: string; name: string; style?: string }>; isLast?: boolean }>(
          `/rest/api/3/project/search?startAt=${startAt}&maxResults=50&orderBy=name`,
        );
        out.push(...result.values.map((p) => ({ id: p.id, key: p.key, name: p.name, style: p.style ?? null })));
        if (result.isLast !== false || result.values.length === 0) break;
        startAt += result.values.length;
      }
      return out;
    },

    async findPointsField() {
      const all = await call<Array<{ id: string; name: string }>>('/rest/api/3/field');
      const named = (name: RegExp) => all.find((f) => name.test(f.name))?.id ?? null;
      return named(/^story point estimate$/i) ?? named(/^story points$/i);
    },

    /** A webhook for the project's issues, made in Jira's admin settings. Its address is returned to remove it by. */
    async registerWebhook(url) {
      const created = await call<{ self: string }>('/rest/webhooks/1.0/webhook', {
        method: 'POST',
        body: {
          name: `Agilefant sync (${config.projectKey})`,
          url,
          events: ['jira:issue_created', 'jira:issue_updated', 'jira:issue_deleted'],
          filters: { 'issue-related-events-section': `project = "${config.projectKey}"` },
          excludeBody: false,
        },
      });
      return created.self;
    },

    async removeWebhook(self) {
      const path = new URL(self).pathname;
      try {
        await call(path, { method: 'DELETE' });
      } catch (e) {
        if (e instanceof JiraError && e.status === 404) return;
        throw e;
      }
    },
  };
}
