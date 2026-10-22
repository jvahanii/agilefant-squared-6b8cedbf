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
  jiraTypeUnder,
  normalizeText,
  reconcile,
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
}

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
  readonly report = emptyReport();

  constructor(
    private readonly jira: JiraPort,
    private readonly agilefant: AgilefantPort,
  ) {}

  private async loadLinks() {
    if (this.loaded) return;
    for (const link of await this.agilefant.links()) this.remember(link);
    this.loaded = true;
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
      status: jiraStatusFor(item.status),
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
    const mine = this.stateOfItem(item);
    const { state, toAgilefant, toJira } = reconcile(link.agreed, mine, issue.state, agilefantChangedAt, jiraChangedAt);
    let error: string | null = null;

    let jiraType = issue.type;
    let retyped = false;
    let fieldsForJira = toJira;
    // A new parent may need a new issue type: Jira's move, before the edit.
    if (toJira.includes('parent')) {
      try {
        const moved = await this.retypeForParent(issue, state.parent);
        if (moved) {
          jiraType = moved.type;
          retyped = true;
          // A move to a subtask sets the parent itself.
          if (moved.parentSet) fieldsForJira = toJira.filter((f) => f !== 'parent');
        }
      } catch (e) {
        error = `${issue.key}: ${message(e)}`;
        this.report.errors.push(error);
        // Tried again next time, as a refused edit is.
        state.parent = link.agreed?.parent ?? issue.state.parent;
        fieldsForJira = toJira.filter((f) => f !== 'parent');
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
      await this.agilefant.updateItem(item.id, this.itemFields(toAgilefant, state, item));
      this.report.updatedInAgilefant += 1;
    }
    const next: Link = { ...link, jiraType, agreed: state, error };
    this.remember(next);
    await this.agilefant.saveLink(next);
  }

  /**
   * Change the issue's type when its new parent asks for another, and say what
   * was done; null when the type can stay. Throws, with words a person can act
   * on, where Jira has no place for the issue there.
   */
  private async retypeForParent(issue: JiraIssue, parent: string | null) {
    const parentType = parent ? this.linksByIssue.get(parent)?.jiraType ?? null : null;
    const wanted = jiraTypeUnder(parentType, issue.type);
    if (!wanted) throw new Error('Jira has nothing below a subtask, so it cannot go there');
    if (wanted === issue.type) return null;
    const children = [...this.linksByIssue.values()].filter((l) => l.agreed?.parent === issue.id);
    if (children.length > 0 && wanted === 'Subtask') {
      throw new Error(`it has ${children.length} item(s) under it, and a subtask cannot have any — move them first`);
    }
    if (children.length > 0 && issue.type === 'Epic') {
      throw new Error(`it is an epic with ${children.length} item(s) under it — move them first`);
    }
    await this.jira.changeType(issue.id, wanted, parent);
    return { type: wanted, parentSet: wanted === 'Subtask' };
  }

  /** The Agilefant values for these fields of a state. */
  private itemFields(fields: SyncedField[], state: SyncState, current: AgilefantItem | null): ItemFields {
    const out: ItemFields = {};
    for (const field of fields) {
      if (field === 'title') out.title = state.title;
      if (field === 'description') out.description = state.description;
      if (field === 'points') out.points = state.points;
      if (field === 'status') out.status = agilefantStatusFor(state.status, null, current?.status);
      if (field === 'parent') out.parentId = state.parent ? this.linksByIssue.get(state.parent)?.workItemId ?? null : null;
    }
    return out;
  }

  private async createInJira(item: AgilefantItem) {
    const state = this.stateOfItem(item);
    const parentLink = item.parentId ? this.linksByItem.get(item.parentId) : undefined;
    const type = jiraTypeForNewItem(parentLink?.jiraType ?? null);
    if (!type) {
      this.report.skipped.push(`"${item.title}" is below a subtask, which Jira cannot hold`);
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

  private async createInAgilefant(issue: JiraIssue) {
    const parentId = issue.state.parent ? this.linksByIssue.get(issue.state.parent)?.workItemId ?? null : null;
    const workItemId = await this.agilefant.createItem({
      title: issue.state.title,
      description: issue.state.description,
      status: agilefantStatusFor(issue.state.status, issue.statusCategory, null),
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
