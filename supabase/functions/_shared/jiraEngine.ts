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
  expectedTypes,
  jiraStatusFor,
  jiraTypeForNewItem,
  Levels,
  normalizeText,
  normalizeHyperlinks,
  sameField,
  type SyncHyperlink,
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
  /** Its links to other issues; undefined where Jira was not asked for them. */
  issueLinks?: IssueLinkRef[];
}

/**
 * A link between two issues in Jira — "blocks", "relates to" — as one of the
 * item's hyperlinks in Agilefant: from Jira one way, never sent back as a web link.
 */
export interface IssueLinkRef {
  /** Jira's id of the link. */
  id: string;
  /** How this issue stands to the other, and which: "blocks INT-12". */
  title: string;
  /** The other issue's key. */
  key: string;
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
  hyperlinks?: SyncHyperlink[];
  /** The hyperlinks that stand for Jira's issue links, by the link's id. */
  issueLinks?: Array<Pick<IssueLinkRef, 'id' | 'title'>>;
  status: string;
  points: number | null;
  /** The parent work item within the list, or null. */
  parentId: string | null;
  /**
   * On the list the project is kept in step with. An item paired with an issue
   * and moved elsewhere is not, and keeps syncing all the same; only one in
   * the list is ever sent to Jira as new.
   */
  inList: boolean;
}

export interface ItemFields {
  title?: string;
  description?: string;
  hyperlinks?: SyncHyperlink[];
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
  /**
   * The item's sync stopped from its menu: the pair is kept, so neither side
   * is taken for a new one, but nothing travels either way. Deleting one side
   * leaves the other, and the pair stays while either does — forgotten, the
   * one left would be taken for new and made again on the other side.
   */
  stopped?: boolean;
}

export interface AgilefantPort {
  listItems(): Promise<AgilefantItem[]>;
  /** The item, or null when it no longer exists. */
  getItem(id: string): Promise<AgilefantItem | null>;
  createItem(fields: Required<ItemFields>): Promise<string>;
  updateItem(id: string, fields: ItemFields): Promise<void>;
  /** Make the item's issue-link hyperlinks these, adding, changing and removing as needed. */
  writeIssueLinks?(id: string, links: IssueLinkRef[]): Promise<void>;
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

/** Pairs whose hyperlinks are checked at once: enough to be quick, few enough not to flood Jira. */
const HYPERLINK_CHECKS_AT_ONCE = 4;

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
      hyperlinks: normalizeHyperlinks(item.hyperlinks),
      status: this.toJiraStatus(item.status),
      points: item.points ?? null,
      parent: item.parentId ? this.linksByItem.get(item.parentId)?.jiraId ?? null : null,
    };
  }

  /**
   * The item as Jira should have it. Its parent is its Agilefant parent's
   * issue — but where the item is deeper than Jira's levels, the issue it is
   * flattened under, as the sync placed it. Otherwise the two would differ
   * for good, and every sync would try again to put it where Jira cannot.
   */
  private async jiraStateOfItem(item: AgilefantItem, jiraId: string): Promise<SyncState> {
    const state = this.stateOfItem(item);
    if (!state.parent) return state;
    const plan = planMove(this.jiraTree(), jiraId, state.parent, await this.levels());
    if ('placements' in plan) {
      const own = plan.placements.find((p) => p.id === jiraId);
      if (own?.flattened) state.parent = own.parent;
    }
    return state;
  }

  /**
   * An Agilefant item changed: send it to Jira, or take its issue out of Jira
   * when it was deleted. A paired item keeps syncing wherever it was moved —
   * out of the list, or to another tree; only one never paired, outside the
   * list, is none of the sync's business.
   */
  async syncItem(itemId: string, depth = 0): Promise<void> {
    await this.loadLinks();
    const item = await this.agilefant.getItem(itemId);
    const link = this.linksByItem.get(itemId);

    if (link?.stopped) return;
    if (!item) {
      if (link) {
        await this.deleteInJira(link);
      }
      return;
    }
    if (!item.inList && !link) return;

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

  /**
   * An item's sync resumed, its pair no longer stopped: brought in step from
   * where the two last agreed. Where its issue was deleted while stopped, the
   * item is not deleted for it but made a new issue, as an item never synced.
   */
  async resumeItem(itemId: string): Promise<void> {
    await this.loadLinks();
    const link = this.linksByItem.get(itemId);
    if (link) {
      link.stopped = false;
      const item = await this.agilefant.getItem(itemId);
      if (!item) return this.forget(link);
      if (!(await this.jira.getIssue(link.jiraId))) await this.forget(link);
    }
    await this.syncItem(itemId);
  }

  /** A Jira issue changed: bring it into Agilefant, or take it out when Jira deleted it. */
  async syncIssue(issueId: string, depth = 0): Promise<void> {
    await this.loadLinks();
    const issue = await this.jira.getIssue(issueId);
    const link = this.linksByIssue.get(issueId);

    if (link?.stopped) return;
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
    if (!item) {
      await this.deleteInJira(link);
      return;
    }
    // Jira's change is the later one.
    await this.reconcilePair(link, item, issue, null, issue.updatedAt);
    await this.bringIssueLinks(link, issue, item);
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

    // Pairs whose either side is gone. What is deleted here is still in the
    // lists read above, and must not come back as new from the other side.
    const deletedIssues = new Set<string>();
    const deletedItems = new Set<string>();
    for (const link of [...this.linksByItem.values()]) {
      const item = itemById.get(link.workItemId);
      const issue = issueById.get(link.jiraId);
      if (link.stopped) {
        if (!item && !issue) await this.forget(link);
        continue;
      }
      if (!item && !issue) await this.forget(link);
      else if (!item) {
        if (await this.deleteInJira(link)) deletedIssues.add(link.jiraId);
      } else if (!issue) {
        await this.deleteInAgilefant(link, item);
        deletedItems.add(item.id);
      }
    }

    // Issues new to Agilefant, epics first.
    const depthOfIssue = (issue: JiraIssue, seen = 0): number =>
      issue.state.parent && issueById.has(issue.state.parent) && seen < MAX_DEPTH
        ? 1 + depthOfIssue(issueById.get(issue.state.parent)!, seen + 1)
        : 0;
    for (const issue of [...issues].sort((a, b) => depthOfIssue(a) - depthOfIssue(b))) {
      if (!this.linksByIssue.has(issue.id) && !deletedIssues.has(issue.id)) await this.createInAgilefant(issue);
    }

    // Items new to Jira, top level first.
    const depthOfItem = (item: AgilefantItem, seen = 0): number =>
      item.parentId && itemById.has(item.parentId) && seen < MAX_DEPTH
        ? 1 + depthOfItem(itemById.get(item.parentId)!, seen + 1)
        : 0;
    for (const item of [...items].sort((a, b) => depthOfItem(a) - depthOfItem(b))) {
      if (item.inList && !this.linksByItem.has(item.id) && !deletedItems.has(item.id)) await this.createInJira(item);
    }

    // Pairs that both still exist. Without a record of when Agilefant last
    // changed, a field changed on both sides is taken from Jira.
    for (const link of [...this.linksByItem.values()]) {
      if (link.stopped) continue;
      const item = itemById.get(link.workItemId) ?? (await this.agilefant.getItem(link.workItemId));
      const issue = issueById.get(link.jiraId) ?? (await this.jira.getIssue(link.jiraId));
      if (item && issue) {
        await this.reconcilePair(link, item, issue, null, issue.updatedAt);
        await this.bringIssueLinks(link, issue, item);
      }
    }

    await this.relevelAll();
    return this.report;
  }

  /** Remote-link changes have no reliable Jira webhook: check only paired links. */
  /**
   * Every pair's hyperlinks checked — Jira announces no change to its web
   * links, so the clock asks every two minutes. A pair takes an item, an
   * issue and its links read; one after another, a space's pairs held its
   * lock for tens of seconds each time, and people's changes queued behind.
   * So: a few pairs at a time, starting each round where `start` says, and
   * stopping as soon as `giveWay` says a change is waiting — the rest are
   * checked next round, from a different start.
   */
  async syncHyperlinks(options: { giveWay?: () => Promise<boolean>; start?: number } = {}): Promise<void> {
    await this.loadLinks();
    const links = [...this.linksByItem.values()];
    const from = links.length ? Math.abs(Math.floor(options.start ?? 0)) % links.length : 0;
    const ordered = [...links.slice(from), ...links.slice(0, from)];
    for (let i = 0; i < ordered.length; i += HYPERLINK_CHECKS_AT_ONCE) {
      if (i > 0 && (await options.giveWay?.())) return;
      await Promise.all(ordered.slice(i, i + HYPERLINK_CHECKS_AT_ONCE).map((link) => this.syncPairHyperlinks(link)));
    }
  }

  private async syncPairHyperlinks(link: Link): Promise<void> {
    if (link.stopped) return;
    try {
      const [item, issue] = await Promise.all([this.agilefant.getItem(link.workItemId), this.jira.getIssue(link.jiraId)]);
      if (!item || !issue) return;
      const result = reconcile(link.agreed, this.stateOfItem(item), issue.state, null, null);
      const hyperlinks = result.state.hyperlinks ?? [];
      if (result.toJira.includes('hyperlinks')) {
        await this.jira.updateIssue(issue.id, ['hyperlinks'], { ...issue.state, hyperlinks });
        this.report.updatedInJira++;
      }
      if (result.toAgilefant.includes('hyperlinks')) {
        await this.agilefant.updateItem(item.id, { hyperlinks });
        this.report.updatedInAgilefant++;
      }
      const next = { ...link, agreed: { ...(link.agreed ?? issue.state), hyperlinks } };
      if (!sameField('hyperlinks', link.agreed?.hyperlinks, hyperlinks) || link.agreed?.hyperlinks === undefined) {
        this.remember(next);
        await this.agilefant.saveLink(next);
      }
    } catch (e) {
      this.report.errors.push(`${link.jiraKey}: ${message(e)}`);
    }
  }

  /**
   * Every tree levelled to the hierarchy as Jira has it now. A move levels
   * the tree it lands in; but when a level is added or taken away in Jira's
   * settings, trees no move has touched since keep types that no longer fit —
   * and the app, which shows each item's type as levelling would make it,
   * would show them changing for good. Each tree whose types differ from
   * that is levelled from its top, as a move would.
   */
  private async relevelAll() {
    const levels = await this.levels();
    const tree = this.jiraTree();
    const wanted = expectedTypes(tree, levels);
    const tops = new Set<string>();
    for (const [id, node] of tree) {
      if (wanted.get(id) === node.type) continue;
      let top = id;
      for (let n = 0, p = tree.get(top)?.parent; p && tree.has(p) && n < 50; n++, p = tree.get(top)?.parent) top = p;
      tops.add(top);
    }
    for (const top of tops) {
      const link = this.linksByIssue.get(top);
      const issue = await this.jira.getIssue(top);
      if (!link || !issue) continue;
      try {
        const moved = await this.rehome(issue, issue.state.parent);
        if (moved?.after && moved.after.type !== link.jiraType) {
          const next: Link = { ...link, jiraType: moved.after.type };
          this.remember(next);
          await this.agilefant.saveLink(next);
        }
        if (moved?.failure) throw moved.failure;
      } catch (e) {
        this.report.errors.push(`${issue.key}: ${message(e)}`);
      }
    }
  }

  private async reconcilePair(
    link: Link,
    item: AgilefantItem,
    issue: JiraIssue,
    agilefantChangedAt: number | null,
    jiraChangedAt: number | null,
  ) {
    await this.prepareStatus(item.status);
    const mine = await this.jiraStateOfItem(item, link.jiraId);
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
              if (field !== 'parent' && !sameField(field, moved.after.state[field], state[field]) && !fieldsForJira.includes(field)) {
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
   * the tree it lands in as planMove says — flattening what falls below
   * Jira's lowest level. Null when only its parent changes, which the
   * ordinary edit does. Throws, changing nothing, for a move under itself.
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
    // Each issue's new type is kept the moment Jira has made it, so the app
    // shows it then rather than when the whole tree is done.
    const keepType = async (id: string, type: string) => {
      const link = this.linksByIssue.get(id);
      if (!link || id === issue.id || link.jiraType === type) return;
      const next: Link = { ...link, jiraType: type };
      this.remember(next);
      await this.agilefant.saveLink(next);
    };
    let failure: unknown = null;
    try {
      for (const p of placements) {
        const at = now.get(p.id)!;
        // Under a parent that changes type, and going elsewhere: let go first, or the parent cannot change.
        const leavesRetyped = Boolean(at.parent && retyped.has(at.parent) && at.parent !== p.parent);
        if (p.type === at.type && !leavesRetyped) continue;
        if (lowest(p.type) && !(at.parent && retyped.has(at.parent))) continue;
        if (lowest(at.type)) {
          const task = levels.defaultAt(0);
          await this.jira.changeType(p.id, task, null);
          now.set(p.id, { type: task, parent: null });
          if (p.type === task) await keepType(p.id, task);
        } else if (at.parent) {
          await this.jira.updateIssue(p.id, ['parent'], stateFor(p.id, null));
          at.parent = null;
        }
      }
      for (const p of placements) {
        const at = now.get(p.id)!;
        if (lowest(p.type)) {
          if (at.type !== p.type || at.parent !== p.parent) {
            await this.jira.changeType(p.id, p.type, p.parent);
            await keepType(p.id, p.type);
          }
          continue;
        }
        if (at.type !== p.type) {
          await this.jira.changeType(p.id, p.type, null);
          await keepType(p.id, p.type);
        }
        if (at.parent !== p.parent) await this.jira.updateIssue(p.id, ['parent'], stateFor(p.id, p.parent));
      }
    } catch (e) {
      failure = e;
    }

    let after: JiraIssue | null = null;
    const reads = await Promise.all(placements.map((p) => this.jira.getIssue(p.id)));
    for (const [i, p] of placements.entries()) {
      const read = reads[i];
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
      if (field === 'hyperlinks') out.hyperlinks = normalizeHyperlinks(state.hyperlinks);
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
      await this.sendNewHyperlinks(link, state);
    } catch (e) {
      this.report.errors.push(`"${item.title}": ${message(e)}`);
    }
  }

  /**
   * A new item under a subtask: made as the subtask of the issue it is
   * flattened under, where the tree is as deep as Jira goes; otherwise made a
   * task on its own, then moved in, the tree raised to hold it.
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
    // Nothing else changes: made straight where it goes.
    if (plan.placements.length === 1) {
      const [own] = plan.placements;
      const placed: SyncState = { ...state, parent: own.parent };
      try {
        const created = await this.jira.createIssue(own.type, placed);
        const link: Link = { workItemId: item.id, jiraId: created.id, jiraKey: created.key, jiraType: own.type, agreed: placed };
        this.remember(link);
        await this.agilefant.saveLink(link);
        this.report.createdInJira += 1;
        await this.sendNewHyperlinks(link, placed);
      } catch (e) {
        this.report.errors.push(`"${item.title}": ${message(e)}`);
      }
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
      await this.sendNewHyperlinks(link, alone);
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
      hyperlinks: normalizeHyperlinks(issue.state.hyperlinks),
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
    await this.bringIssueLinks(link, issue, null);
  }

  /**
   * The issue's links to other issues — "blocks INT-12" — as the item's
   * hyperlinks: Jira's, so from Jira one way, and written only where they
   * differ from what the item has. A failure is reported, not thrown: the
   * rest of the pair is in step all the same.
   */
  private async bringIssueLinks(link: Link, issue: JiraIssue, item: AgilefantItem | null) {
    if (link.stopped || !issue.issueLinks || !this.agilefant.writeIssueLinks) return;
    const byId = (a: { id: string }, b: { id: string }) => a.id.localeCompare(b.id);
    const want = [...issue.issueLinks].sort(byId);
    const have = [...(item?.issueLinks ?? [])].sort(byId);
    if (want.length === have.length && want.every((l, i) => l.id === have[i].id && l.title === have[i].title)) return;
    try {
      await this.agilefant.writeIssueLinks(link.workItemId, want);
    } catch (e) {
      this.report.errors.push(`${link.jiraKey}: issue links: ${message(e)}`);
    }
  }

  /** Keep the issue's identity even if its separate remote-link write fails. */
  private async sendNewHyperlinks(link: Link, state: SyncState) {
    if (!state.hyperlinks?.length) return;
    try {
      await this.jira.updateIssue(link.jiraId, ['hyperlinks'], state);
    } catch (e) {
      const error = `${link.jiraKey}: ${message(e)}`;
      this.report.errors.push(error);
      link.agreed = { ...state, hyperlinks: [] };
      link.error = error;
      await this.agilefant.saveLink(link);
    }
  }

  /**
   * The issue of an item deleted in Agilefant deleted
   * in Jira. Where Jira refuses — no permission to delete, say — the pair is
   * kept, with the error: forgotten, the issue would stay in Jira for good, and
   * the next full sync would bring it back into Agilefant as a new item. Kept,
   * it is tried again by every full sync and every change Jira sends about it.
   */
  private async deleteInJira(link: Link): Promise<boolean> {
    try {
      await this.jira.deleteIssue(link.jiraId);
      this.report.deletedInJira += 1;
    } catch (e) {
      const error = `${link.jiraKey}: ${message(e)}`;
      this.report.errors.push(error);
      const next: Link = { ...link, error };
      this.remember(next);
      await this.agilefant.saveLink(next);
      return false;
    }
    await this.forget(link);
    return true;
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
