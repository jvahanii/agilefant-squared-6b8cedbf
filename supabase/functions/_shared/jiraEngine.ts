// Keeping one Agilefant list and one Jira project in step.
//
// The rules of what stands for what are in jiraMapping.ts; this is the order
// of doing things. It reaches Jira and Agilefant only through the two ports
// below, so the edge function gives it the real ones and the tests give it
// stand-ins.
//
// Three ways in:
//   syncItem   — an Agilefant item changed (a database trigger queued it)
//   syncIssue  — a Jira issue changed (Jira's webhook said so)
//   fullSync   — everything, both ways (the "Sync now" button, and the first time)

import {
  agilefantStatusFor,
  jiraStatusFor,
  jiraTypeForNewItem,
  Levels,
  normalizeText,
  planMove,
  type IssueTypeLevel,
  reconcile,
  SYNCED_FIELDS,
  toSummary,
  type SyncState,
  type SyncedField,
} from './jiraMapping.ts';

export interface JiraIssue {
  id: string;
  key: string;
  type: string;
  state: SyncState;
  statusCategory: string | null;
  /** When Jira last changed it, epoch milliseconds. */
  updatedAt: number;
}

export interface JiraPort {
  listIssues(): Promise<JiraIssue[]>;
  /** The issue, or null when it no longer exists. */
  getIssue(id: string): Promise<JiraIssue | null>;
  createIssue(type: string, state: SyncState): Promise<{ id: string; key: string }>;
  /** Give the issue these fields of `state`: the status by a transition, the rest by an edit. */
  updateIssue(id: string, fields: SyncedField[], state: SyncState): Promise<void>;
  deleteIssue(id: string): Promise<void>;
  /**
   * Make the issue of another type, under this parent (null for none) — Jira's
   * move, the only way a task becomes a subtask or back.
   */
  changeType(id: string, type: string, parent: string | null): Promise<void>;
  /** The project's status by this name, added to its workflow when it has none; returns Jira's spelling. */
  ensureStatus?(name: string): Promise<string>;
  /** The project's issue types and their levels; without it, Jira's three. */
  issueTypes?(): Promise<IssueTypeLevel[]>;
}

export interface AgilefantItem {
  id: string;
  title: string;
  description: string | null;
  status: string;
  points: number | null;
  /** The parent work item within the list, or null. */
  parentId: string | null;
  /** Still on the list the project is kept in step with. */
  inList: boolean;
}

export interface ItemFields {
  title?: string;
  description?: string;
  status?: string;
  points?: number | null;
  parentId?: string | null;
}

export interface Link {
  workItemId: string;
  jiraId: string;
  jiraKey: string;
  jiraType: string;
  /** What both sides held when they last agreed; null for a pair not yet synced. */
  agreed: SyncState | null;
  error?: string | null;
}

export interface AgilefantPort {
  listItems(): Promise<AgilefantItem[]>;
  /** The item, or null when it no longer exists. */
  getItem(id: string): Promise<AgilefantItem | null>;
  createItem(fields: Required<ItemFields>): Promise<string>;
  updateItem(id: string, fields: ItemFields): Promise<void>;
  /** Delete the item, its children first moved to the top level as Jira does. */
  deleteItem(id: string): Promise<void>;
  links(): Promise<Link[]>;
  saveLink(link: Link): Promise<void>;
  dropLink(workItemId: string): Promise<void>;
  /** The connected list's statuses, as its items see them. */
  statuses?(): Promise<{ key: string; label: string }[]>;
  /** Add a status to the connected list's set; returns its key. */
  createStatus?(label: string, category: string | null): Promise<string>;
}

const BUILT_IN_STATUSES = new Set(['not_started', 'in_progress', 'pending', 'blocked', 'done', 'no_go']);
const MAPPED_JIRA_STATUSES = new Set(['to do', 'in progress', 'in review', 'done']);

export interface SyncReport {
  createdInAgilefant: number;
  createdInJira: number;
  updatedInAgilefant: number;
  updatedInJira: number;
  deletedInAgilefant: number;
  deletedInJira: number;
  skipped: string[];
  errors: string[];
}

const emptyReport = (): SyncReport => ({
  createdInAgilefant: 0,
  createdInJira: 0,
  updatedInAgilefant: 0,
  updatedInJira: 0,
  deletedInAgilefant: 0,
  deletedInJira: 0,
  skipped: [],
  errors: [],
});

/** How deep a chain of parents is followed before giving up: Jira has three levels. */
const MAX_DEPTH = 6;

export class JiraSync {
  private linksByItem = new Map<string, Link>();
  private linksByIssue = new Map<string, Link>();
  private loaded = false;
  private statuses: { key: string; label: string }[] = [];
  /** Agilefant's own statuses → the Jira status each goes to. */
  private jiraNames = new Map<string, string>();
  readonly report = emptyReport();

  constructor(
    private readonly jira: JiraPort,
    private readonly agilefant: AgilefantPort,
  ) {}

  private async loadLinks() {
    if (this.loaded) return;
    for (const link of await this.agilefant.links()) this.remember(link);
    this.statuses = (await this.agilefant.statuses?.()) ?? [];
    this.loaded = true;
  }

  /** The Jira status an item's status stands for: a list's own status by its name. */
  private toJiraStatus(key: string): string {
    if (!BUILT_IN_STATUSES.has(key)) {
      const own = this.statuses.find((s) => s.key === key);
      if (own) return this.jiraNames.get(key) ?? own.label;
    }
    return jiraStatusFor(key);
  }

  /**
   * Make sure Jira has a list's own status before an item in it is sent: added
   * to the project when missing; where Jira refuses, the item goes as In Progress.
   */
  private async prepareStatus(key: string) {
    if (BUILT_IN_STATUSES.has(key) || this.jiraNames.has(key)) return;
    const own = this.statuses.find((s) => s.key === key);
    if (!own) return;
    if (MAPPED_JIRA_STATUSES.has(own.label.trim().toLowerCase())) return;
    if (!this.jira.ensureStatus) return;
    try {
      this.jiraNames.set(key, await this.jira.ensureStatus(own.label));
    } catch (e) {
      this.jiraNames.set(key, 'In Progress');
      this.report.errors.push(`status "${own.label}" could not be added to Jira (${message(e)}); sent as In Progress`);
    }
  }

  /**
   * The Agilefant status for a Jira status. One Agilefant does not have is
   * added to the list's statuses under Jira's name.
   */
  private async toAgilefantStatus(jiraStatus: string, category: string | null, current: string | null | undefined): Promise<string> {
    if (current && this.toJiraStatus(current) === jiraStatus) return current;
    const name = jiraStatus.trim().toLowerCase();
    if (MAPPED_JIRA_STATUSES.has(name)) return agilefantStatusFor(jiraStatus, category, current);
    const own = this.statuses.find((s) => s.label.trim().toLowerCase() === name);
    if (own) return own.key;
    if (!this.agilefant.createStatus) return agilefantStatusFor(jiraStatus, category, current);
    try {
      const key = await this.agilefant.createStatus(jiraStatus.trim(), category);
      this.statuses.push({ key, label: jiraStatus.trim() });
      return key;
    } catch (e) {
      this.report.errors.push(`status "${jiraStatus}": ${message(e)}`);
      return agilefantStatusFor(jiraStatus, category, current);
    }
  }

  private remember(link: Link) {
    this.linksByItem.set(link.workItemId, link);
    this.linksByIssue.set(link.jiraId, link);
  }

  private async forget(link: Link) {
    this.linksByItem.delete(link.workItemId);
    this.linksByIssue.delete(link.jiraId);
    await this.agilefant.dropLink(link.workItemId);
  }

  /** The item as a state: its parent named by the parent's Jira id, once the parent has one. */
  private stateOfItem(item: AgilefantItem): SyncState {
    return {
      title: toSummary(item.title),
      description: normalizeText(item.description),
      status: this.toJiraStatus(item.status),
      points: item.points ?? null,
      parent: item.parentId ? this.linksByItem.get(item.parentId)?.jiraId ?? null : null,
    };
  }

  /** An Agilefant item changed: send it to Jira, or take it out of Jira when it left the list. */
  async syncItem(itemId: string, depth = 0): Promise<void> {
    await this.loadLinks();
    const item = await this.agilefant.getItem(itemId);
    const link = this.linksByItem.get(itemId);

    if (!item || !item.inList) {
      if (link) {
        await this.deleteInJira(link);
      }
      return;
    }

    // A parent with no Jira issue yet gets one first, so this item can name it.
    if (item.parentId && !this.linksByItem.has(item.parentId) && depth < MAX_DEPTH) {
      await this.syncItem(item.parentId, depth + 1);
    }

    if (!link) {
      await this.createInJira(item);
      return;
    }
    const issue = await this.jira.getIssue(link.jiraId);
    if (!issue) {
      await this.deleteInAgilefant(link, item);
      return;
    }
    // The change just made in Agilefant is the later one.
    await this.reconcilePair(link, item, issue, Date.now(), issue.updatedAt);
  }

  /** A Jira issue changed: bring it into Agilefant, or take it out when Jira deleted it. */
  async syncIssue(issueId: string, depth = 0): Promise<void> {
    await this.loadLinks();
    const issue = await this.jira.getIssue(issueId);
    const link = this.linksByIssue.get(issueId);

    if (!issue) {
      if (link) {
        const item = await this.agilefant.getItem(link.workItemId);
        if (item) await this.deleteInAgilefant(link, item);
        else await this.forget(link);
      }
      return;
    }

    if (issue.state.parent && !this.linksByIssue.has(issue.state.parent) && depth < MAX_DEPTH) {
      await this.syncIssue(issue.state.parent, depth + 1);
    }

    if (!link) {
      await this.createInAgilefant(issue);
      return;
    }
    const item = await this.agilefant.getItem(link.workItemId);
    if (!item || !item.inList) {
      await this.deleteInJira(link);
      return;
    }
    // Jira's change is the later one.
    await this.reconcilePair(link, item, issue, null, issue.updatedAt);
  }

  /**
   * Everything, both ways. Parents before children on both sides, so every
   * child can name its parent; pairs already made reconciled field by field.
   */
  async fullSync(): Promise<SyncReport> {
    await this.loadLinks();
    const [items, issues] = await Promise.all([this.agilefant.listItems(), this.jira.listIssues()]);
    const itemById = new Map(items.map((i) => [i.id, i]));
    const issueById = new Map(issues.map((i) => [i.id, i]));

    // Pairs whose either side is gone.
    for (const link of [...this.linksByItem.values()]) {
      const item = itemById.get(link.workItemId);
      const issue = issueById.get(link.jiraId);
      if (!item && !issue) await this.forget(link);
      else if (!item) await this.deleteInJira(link);
      else if (!issue) await this.deleteInAgilefant(link, item);
    }

    // Issues new to Agilefant, epics first.
    const depthOfIssue = (issue: JiraIssue, seen = 0): number =>
      issue.state.parent && issueById.has(issue.state.parent) && seen < MAX_DEPTH
        ? 1 + depthOfIssue(issueById.get(issue.state.parent)!, seen + 1)
        : 0;
    for (const issue of [...issues].sort((a, b) => depthOfIssue(a) - depthOfIssue(b))) {
      if (!this.linksByIssue.has(issue.id)) await this.createInAgilefant(issue);
    }

    // Items new to Jira, top level first.
    const depthOfItem = (item: AgilefantItem, seen = 0): number =>
      item.parentId && itemById.has(item.parentId) && seen < MAX_DEPTH
        ? 1 + depthOfItem(itemById.get(item.parentId)!, seen + 1)
        : 0;
    for (const item of [...items].sort((a, b) => depthOfItem(a) - depthOfItem(b))) {
      if (!this.linksByItem.has(item.id)) await this.createInJira(item);
    }

    // Pairs that both still exist. Without a record of when Agilefant last
    // changed, a field changed on both sides is taken from Jira.
    for (const link of [...this.linksByItem.values()]) {
      const item = itemById.get(link.workItemId) ?? (await this.agilefant.getItem(link.workItemId));
      const issue = issueById.get(link.jiraId) ?? (await this.jira.getIssue(link.jiraId));
      if (item && item.inList && issue) await this.reconcilePair(link, item, issue, null, issue.updatedAt);
    }
    return this.report;
  }

  private async reconcilePair(
    link: Link,
    item: AgilefantItem,
    issue: JiraIssue,
    agilefantChangedAt: number | null,
    jiraChangedAt: number | null,
  ) {
    await this.prepareStatus(item.status);
    const mine = this.stateOfItem(item);
    const { state, toAgilefant, toJira } = reconcile(link.agreed, mine, issue.state, agilefantChangedAt, jiraChangedAt);
    let error: string | null = null;

    let jiraType = issue.type;
    let retyped = false;
    let fieldsForJira = toJira;
    // A new parent may need new issue types around it: Jira's moves, before the edit.
    if (toJira.includes('parent')) {
      try {
        const moved = await this.rehome(issue, state.parent);
        if (moved) {
          retyped = true;
          fieldsForJira = toJira.filter((f) => f !== 'parent');
          if (moved.after) {
            // Agreed on where it really is; anything the moves changed besides goes back.
            jiraType = moved.after.type;
            state.parent = moved.after.state.parent;
            for (const field of SYNCED_FIELDS) {
              if (field !== 'parent' && moved.after.state[field] !== state[field] && !fieldsForJira.includes(field)) {
                fieldsForJira.push(field);
              }
            }
          } else {
            state.parent = link.agreed?.parent ?? issue.state.parent;
          }
          if (moved.failure) throw moved.failure;
        }
      } catch (e) {
        error = `${issue.key}: ${message(e)}`;
        this.report.errors.push(error);
        if (!retyped) {
          // Tried again next time, as a refused edit is.
          state.parent = link.agreed?.parent ?? issue.state.parent;
          fieldsForJira = toJira.filter((f) => f !== 'parent');
        }
      }
    }
    if (fieldsForJira.length > 0) {
      try {
        await this.jira.updateIssue(issue.id, fieldsForJira, state);
        this.report.updatedInJira += 1;
      } catch (e) {
        error = `${issue.key}: ${message(e)}`;
        this.report.errors.push(error);
        // What could not be sent stays as Jira has it, so it is tried again next time.
        for (const field of fieldsForJira) (state as Record<SyncedField, unknown>)[field] = link.agreed?.[field] ?? issue.state[field];
      }
    } else if (retyped) {
      this.report.updatedInJira += 1;
    }
    if (toAgilefant.length > 0) {
      await this.agilefant.updateItem(item.id, await this.itemFields(toAgilefant, state, item, issue.statusCategory));
      this.report.updatedInAgilefant += 1;
    }
    const next: Link = { ...link, jiraType, agreed: state, error };
    this.remember(next);
    await this.agilefant.saveLink(next);
  }

  private levelsRead: Promise<Levels> | null = null;

  /** The project's hierarchy levels, read once; Jira's three if they cannot be read. */
  private levels(): Promise<Levels> {
    this.levelsRead ??= (this.jira.issueTypes?.() ?? Promise.resolve(undefined))
      .then((types) => new Levels(types && types.length > 0 ? types : undefined))
      .catch(() => new Levels());
    return this.levelsRead;
  }

  /** Jira's hierarchy as the pairs know it: each issue's type and parent. */
  private jiraTree() {
    return new Map(
      [...this.linksByIssue.values()].map((l) => [l.jiraId, { type: l.jiraType, parent: l.agreed?.parent ?? null }]),
    );
  }

  /**
   * Put the issue under this parent in Jira, raising or lowering the types of
   * the tree it lands in as planMove says. Null when only its parent changes,
   * which the ordinary edit does. Throws, changing nothing, where the tree
   * cannot fit in Jira's three levels.
   *
   * Jira checks every step, so: whatever changes type is let go of first —
   * a subtask by becoming a task, anything else by losing its parent, unless
   * it is becoming a subtask of a parent that keeps its type, which Jira's
   * move does in one — and the tree is then put together from the top, each
   * parent of its new type before its children come under it. A step that fails stops the rest;
   * either way each issue touched is read back, and its pair agreed on where
   * it really is, so the next sync takes up what is left from Agilefant.
   */
  private async rehome(issue: JiraIssue, parent: string | null) {
    const tree = this.jiraTree();
    tree.set(issue.id, { type: issue.type, parent: issue.state.parent });
    const levels = await this.levels();
    const plan = planMove(tree, issue.id, parent, levels);
    if ('impossible' in plan) throw new Error(plan.impossible);
    const lowest = (type: string) => levels.of(type) === levels.bottom;
    const { placements } = plan;
    if (placements.length === 1 && placements[0].type === issue.type) return null;

    const now = new Map(placements.map((p) => [p.id, { ...tree.get(p.id)! }]));
    const stateFor = (id: string, parentId: string | null): SyncState => ({
      ...(this.linksByIssue.get(id)?.agreed ?? issue.state),
      parent: parentId,
    });
    const retyped = new Set(placements.filter((p) => p.type !== tree.get(p.id)?.type).map((p) => p.id));
    let failure: unknown = null;
    try {
      for (const p of placements) {
        const at = now.get(p.id)!;
        if (p.type === at.type) continue;
        if (lowest(p.type) && !(at.parent && retyped.has(at.parent))) continue;
        if (lowest(at.type)) {
          const task = levels.defaultAt(0);
          await this.jira.changeType(p.id, task, null);
          now.set(p.id, { type: task, parent: null });
        } else if (at.parent) {
          await this.jira.updateIssue(p.id, ['parent'], stateFor(p.id, null));
          at.parent = null;
        }
      }
      for (const p of placements) {
        const at = now.get(p.id)!;
        if (lowest(p.type)) {
          if (at.type !== p.type || at.parent !== p.parent) await this.jira.changeType(p.id, p.type, p.parent);
          continue;
        }
        if (at.type !== p.type) await this.jira.changeType(p.id, p.type, null);
        if (at.parent !== p.parent) await this.jira.updateIssue(p.id, ['parent'], stateFor(p.id, p.parent));
      }
    } catch (e) {
      failure = e;
    }

    let after: JiraIssue | null = null;
    for (const p of placements) {
      const read = await this.jira.getIssue(p.id);
      if (!read) continue;
      if (p.id === issue.id) {
        after = read;
        continue;
      }
      const link = this.linksByIssue.get(p.id);
      if (!link) continue;
      const next: Link = { ...link, jiraType: read.type, agreed: read.state };
      this.remember(next);
      await this.agilefant.saveLink(next);
      this.report.updatedInJira += 1;
    }
    return { after, failure };
  }

  /** The Agilefant values for these fields of a state. */
  private async itemFields(fields: SyncedField[], state: SyncState, current: AgilefantItem | null, category: string | null): Promise<ItemFields> {
    const out: ItemFields = {};
    for (const field of fields) {
      if (field === 'title') out.title = state.title;
      if (field === 'description') out.description = state.description;
      if (field === 'points') out.points = state.points;
      if (field === 'status') out.status = await this.toAgilefantStatus(state.status, category, current?.status);
      if (field === 'parent') out.parentId = state.parent ? this.linksByIssue.get(state.parent)?.workItemId ?? null : null;
    }
    return out;
  }

  private async createInJira(item: AgilefantItem) {
    await this.prepareStatus(item.status);
    const state = this.stateOfItem(item);
    const parentLink = item.parentId ? this.linksByItem.get(item.parentId) : undefined;
    const type = jiraTypeForNewItem(parentLink?.jiraType ?? null, await this.levels());
    if (!type) {
      await this.createUnderSubtask(item, state);
      return;
    }
    try {
      const created = await this.jira.createIssue(type, state);
      const link: Link = { workItemId: item.id, jiraId: created.id, jiraKey: created.key, jiraType: type, agreed: state };
      this.remember(link);
      await this.agilefant.saveLink(link);
      this.report.createdInJira += 1;
    } catch (e) {
      this.report.errors.push(`"${item.title}": ${message(e)}`);
    }
  }

  /**
   * A new item under a subtask: made a task on its own, then moved in, the
   * tree raised to hold it — or not made at all where it cannot fit.
   */
  private async createUnderSubtask(item: AgilefantItem, state: SyncState) {
    const levels = await this.levels();
    const task = levels.defaultAt(0);
    const tree = this.jiraTree();
    tree.set('', { type: task, parent: null });
    const plan = planMove(tree, '', state.parent, levels);
    if ('impossible' in plan) {
      this.report.skipped.push(`"${item.title}": ${plan.impossible}`);
      return;
    }
    const alone: SyncState = { ...state, parent: null };
    let link: Link;
    try {
      const created = await this.jira.createIssue(task, alone);
      link = { workItemId: item.id, jiraId: created.id, jiraKey: created.key, jiraType: task, agreed: alone };
      this.remember(link);
      await this.agilefant.saveLink(link);
      this.report.createdInJira += 1;
    } catch (e) {
      this.report.errors.push(`"${item.title}": ${message(e)}`);
      return;
    }
    const issue: JiraIssue = { id: link.jiraId, key: link.jiraKey, type: task, state: alone, statusCategory: null, updatedAt: 0 };
    let error: string | null = null;
    let after: JiraIssue | null = null;
    try {
      const moved = await this.rehome(issue, state.parent);
      after = moved?.after ?? null;
      if (moved?.failure) throw moved.failure;
    } catch (e) {
      error = `${link.jiraKey}: ${message(e)}`;
      this.report.errors.push(error);
    }
    const next: Link = {
      ...link,
      jiraType: after?.type ?? link.jiraType,
      agreed: { ...alone, parent: after?.state.parent ?? null },
      error,
    };
    this.remember(next);
    await this.agilefant.saveLink(next);
  }

  private async createInAgilefant(issue: JiraIssue) {
    const parentId = issue.state.parent ? this.linksByIssue.get(issue.state.parent)?.workItemId ?? null : null;
    const workItemId = await this.agilefant.createItem({
      title: issue.state.title,
      description: issue.state.description,
      status: await this.toAgilefantStatus(issue.state.status, issue.statusCategory, null),
      points: issue.state.points,
      parentId,
    });
    // Agreed as Jira has it; a parent not yet in Agilefant is filled in when it is.
    const link: Link = {
      workItemId,
      jiraId: issue.id,
      jiraKey: issue.key,
      jiraType: issue.type,
      agreed: { ...issue.state, parent: parentId ? issue.state.parent : null },
    };
    this.remember(link);
    await this.agilefant.saveLink(link);
    this.report.createdInAgilefant += 1;
  }

  private async deleteInJira(link: Link) {
    try {
      await this.jira.deleteIssue(link.jiraId);
      this.report.deletedInJira += 1;
    } catch (e) {
      this.report.errors.push(`${link.jiraKey}: ${message(e)}`);
    }
    await this.forget(link);
  }

  private async deleteInAgilefant(link: Link, item: AgilefantItem) {
    await this.agilefant.deleteItem(item.id);
    this.report.deletedInAgilefant += 1;
    await this.forget(link);
  }
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
