// Jira Cloud's REST API, as much of it as the sync uses.
//
// Signs in as one person with an API token (Basic auth: email + token). The
// token is the JIRA_API_TOKEN secret of the edge functions — it is never
// stored in a table or seen by the app.
//
// Takes its fetch as an argument so it can be tested without a network.

import { adfToText, textToAdf, toPoints, toSummary, type SyncState, type SyncedField } from './jiraMapping.ts';
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
      const parsed = JSON.parse(body) as { errorMessages?: string[]; errors?: Record<string, string>; message?: string };
      const parts = [...(parsed.errorMessages ?? []), ...Object.entries(parsed.errors ?? {}).map(([k, v]) => `${k}: ${v}`)];
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
  findPointsField(): Promise<string | null>;
  registerWebhook(url: string): Promise<string>;
  removeWebhook(self: string): Promise<void>;
} {
  const call = jiraRequester(config, fetcher);
  const fields = ['summary', 'description', 'status', 'issuetype', 'parent', 'updated', ...(config.pointsField ? [config.pointsField] : [])];

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

  return {
    async listIssues() {
      const out: JiraIssue[] = [];
      let nextPageToken: string | undefined;
      for (let page = 0; page < 50; page++) {
        const result = await call<{ issues: RawIssue[]; nextPageToken?: string }>('/rest/api/3/search/jql', {
          method: 'POST',
          body: { jql: `project = "${config.projectKey}" ORDER BY key`, fields, maxResults: 100, nextPageToken },
        });
        out.push(...result.issues.map(toIssue));
        if (!result.nextPageToken) break;
        nextPageToken = result.nextPageToken;
      }
      return out;
    },

    async getIssue(id) {
      try {
        return toIssue(await call<RawIssue>(`/rest/api/3/issue/${id}?fields=${fields.join(',')}`));
      } catch (e) {
        if (e instanceof JiraError && e.status === 404) return null;
        throw e;
      }
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

    async updateIssue(id, names, state) {
      await edit(id, fieldValues(names.filter((n) => n !== 'status'), state));
      if (names.includes('status')) await transitionTo(id, state.status);
    },

    async deleteIssue(id) {
      try {
        await call(`/rest/api/3/issue/${id}?deleteSubtasks=true`, { method: 'DELETE' });
      } catch (e) {
        if (e instanceof JiraError && e.status === 404) return;
        throw e;
      }
    },

    myself: () => call('/rest/api/3/myself'),
    project: () => call(`/rest/api/3/project/${encodeURIComponent(config.projectKey)}`),

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
