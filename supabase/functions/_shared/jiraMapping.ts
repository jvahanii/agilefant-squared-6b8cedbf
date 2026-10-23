// How a Jira issue and an Agilefant work item stand for each other.
//
// One Agilefant list is kept in step with one Jira project, both ways. What
// travels: the name, the description, the status, the points and where the
// item sits in the hierarchy (epic → story/task → subtask in Jira; parent →
// child in Agilefant).
//
// Each side is reduced to the same small record — its "state" — and the
// state both sides agreed on at the last sync is kept with the pair. A side
// whose state differs from that one has changed since; a field that changed
// on one side only is taken from that side; a field that changed on both
// takes the later change. A change applied from one side makes the other
// side's state equal the agreed one again, so it is never sent back — which
// is what keeps a Jira webhook and an Agilefant save from bouncing forever.
//
// Pure, and shared by the edge function and vitest.

/** The fields that travel, as one comparable record. */
export interface SyncState {
  title: string;
  description: string;
  /** Jira's status name, the one both sides map to: "To Do", "In Progress", "In Review", "Done". */
  status: string;
  points: number | null;
  /** The Jira id of the parent issue, or null for none. */
  parent: string | null;
}

export const SYNCED_FIELDS = ['title', 'description', 'status', 'points', 'parent'] as const;
export type SyncedField = (typeof SYNCED_FIELDS)[number];

// ─── Text ────────────────────────────────────────────────────────────────────

/** A description as compared: line endings unified, trailing space and extra blank lines gone. */
export function normalizeText(text: string | null | undefined): string {
  return (text ?? '')
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map((line) => line.replace(/\s+$/, ''))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** A Jira summary: one line, at most 255 characters. */
export function toSummary(title: string): string {
  return title.replace(/\s+/g, ' ').trim().slice(0, 255) || '(untitled)';
}

type AdfNode = { type: string; text?: string; content?: AdfNode[]; attrs?: Record<string, unknown> };
type AdfDocument = AdfNode & { type: 'doc'; version: 1 };

/**
 * Jira's description, Atlassian Document Format, as plain text: paragraphs
 * apart by a blank line, list items as "- item", headings as their text.
 * Formatting that has no plain-text form — bold, colour, mentions — is read
 * as its text.
 */
export function adfToText(doc: unknown): string {
  if (!doc || typeof doc !== 'object') return typeof doc === 'string' ? normalizeText(doc) : '';
  const inline = (node: AdfNode): string => {
    if (node.type === 'text') return node.text ?? '';
    if (node.type === 'hardBreak') return '\n';
    if (node.type === 'mention') return String(node.attrs?.text ?? '');
    if (node.type === 'emoji') return String(node.attrs?.text ?? node.attrs?.shortName ?? '');
    if (node.type === 'inlineCard') return String(node.attrs?.url ?? '');
    return (node.content ?? []).map(inline).join('');
  };
  const block = (node: AdfNode, listPrefix = ''): string[] => {
    switch (node.type) {
      case 'doc':
        return (node.content ?? []).flatMap((child) => block(child));
      case 'bulletList':
      case 'orderedList':
        return [
          (node.content ?? [])
            .map((item, i) => {
              const marker = node.type === 'orderedList' ? `${i + 1}. ` : '- ';
              const lines = (item.content ?? []).flatMap((child) => block(child, listPrefix + '  '));
              return `${listPrefix}${marker}${lines.join('\n').trimStart()}`;
            })
            .join('\n'),
        ];
      case 'paragraph':
      case 'heading':
      case 'codeBlock':
      case 'blockquote':
      case 'panel':
        return node.type === 'paragraph' || node.type === 'heading' || node.type === 'codeBlock'
          ? [inline(node)]
          : (node.content ?? []).flatMap((child) => block(child, listPrefix));
      case 'rule':
        return ['---'];
      default:
        return node.content ? (node.content ?? []).flatMap((child) => block(child, listPrefix)) : [inline(node)];
    }
  };
  return normalizeText(block(doc as AdfNode).join('\n\n'));
}

/**
 * Plain text as a Jira description: a paragraph per blank-line-separated
 * block, its lines kept apart by hard breaks, and "- " lines as a bullet
 * list. Written so that adfToText reads back exactly the normalized text.
 */
export function textToAdf(text: string | null | undefined): AdfDocument | null {
  const normalized = normalizeText(text);
  if (!normalized) return null;
  const content: AdfNode[] = [];
  for (const block of normalized.split(/\n\n/)) {
    const lines = block.split('\n');
    if (lines.every((line) => /^- /.test(line))) {
      content.push({
        type: 'bulletList',
        content: lines.map((line) => ({
          type: 'listItem',
          content: [{ type: 'paragraph', content: [{ type: 'text', text: line.slice(2) }] }],
        })),
      });
      continue;
    }
    const inline: AdfNode[] = [];
    lines.forEach((line, i) => {
      if (i > 0) inline.push({ type: 'hardBreak' });
      if (line) inline.push({ type: 'text', text: line });
    });
    content.push({ type: 'paragraph', content: inline });
  }
  return { type: 'doc', version: 1, content };
}

// ─── Status ──────────────────────────────────────────────────────────────────

/** The Jira status an Agilefant status stands for. */
export function jiraStatusFor(agilefantStatus: string | null | undefined): string {
  switch (agilefantStatus) {
    case 'in_progress':
    case 'blocked':
      return 'In Progress';
    case 'pending':
      return 'In Review';
    case 'done':
    case 'no_go':
      return 'Done';
    default:
      return 'To Do';
  }
}

/**
 * The Agilefant status for a Jira status. An item whose status already stands
 * for it keeps its own — "blocked" stays blocked when Jira says In Progress —
 * so a round trip never flattens Agilefant's finer statuses.
 */
export function agilefantStatusFor(
  jiraStatus: string,
  jiraCategory: string | null | undefined,
  current: string | null | undefined,
): string {
  if (current && jiraStatusFor(current) === jiraStatus) return current;
  switch (jiraStatus) {
    case 'To Do':
      return 'not_started';
    case 'In Progress':
      return 'in_progress';
    case 'In Review':
      return 'pending';
    case 'Done':
      return 'done';
  }
  if (jiraCategory === 'done') return 'done';
  if (jiraCategory === 'indeterminate') return 'in_progress';
  return 'not_started';
}

// ─── Points ──────────────────────────────────────────────────────────────────

export function toPoints(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const n = Number(value);
  return Number.isFinite(n) ? Math.round(n) : null;
}

// ─── Hierarchy ───────────────────────────────────────────────────────────────

/** An issue type and its level in Jira's hierarchy: -1 a subtask, 0 a task or story, 1 an epic, above that what the site adds. */
export interface IssueTypeLevel {
  name: string;
  level: number;
}

/** Jira's hierarchy without levels added above the epic. */
export const DEFAULT_ISSUE_TYPES: IssueTypeLevel[] = [
  { name: 'Epic', level: 1 },
  { name: 'Story', level: 0 },
  { name: 'Task', level: 0 },
  { name: 'Bug', level: 0 },
  { name: 'Subtask', level: -1 },
];

/**
 * The levels of the project's hierarchy, read from its issue types. Jira has
 * subtasks at the bottom, tasks and stories over them, epics over those, and
 * on Premium as many levels above the epic as the site adds — each with one
 * type. A child is always exactly one level below its parent.
 */
export class Levels {
  /** The lowest level: subtasks. */
  readonly bottom: number;
  /** The highest level with no gap below it. */
  readonly top: number;
  private readonly byName: Map<string, number>;

  constructor(private readonly types: IssueTypeLevel[] = DEFAULT_ISSUE_TYPES) {
    if (!types.some((t) => t.level === 0)) types = DEFAULT_ISSUE_TYPES;
    this.types = types;
    this.byName = new Map(types.map((t) => [t.name, t.level]));
    this.bottom = types.some((t) => t.level === -1) ? -1 : 0;
    let top = 0;
    while (types.some((t) => t.level === top + 1)) top += 1;
    this.top = top;
  }

  /** The level of a type; one Jira did not name is taken for a task. */
  of(type: string): number {
    return this.byName.get(type) ?? 0;
  }

  /** How many levels there are. */
  get count(): number {
    return this.top - this.bottom + 1;
  }

  /** The type an issue on this level is, when it has to be made one. */
  defaultAt(level: number): string {
    const here = this.types.filter((t) => t.level === level).map((t) => t.name);
    if (level === 0) return here.includes('Task') ? 'Task' : here[0];
    return here[0];
  }

  /**
   * The type for an issue now on this level: its own where the level is the
   * same; an epic lowered to a task's level a story, as asked in the workshop,
   * and anything else the level's own type.
   */
  typeAt(level: number, current: string): string {
    if (level === this.of(current)) return current;
    if (level === 0 && this.of(current) > 0 && this.types.some((t) => t.name === 'Story' && t.level === 0)) return 'Story';
    return this.defaultAt(level);
  }

  /** The levels by name, highest first: "Initiative, Epic, Story/Task/Bug, Subtask". */
  describe(): string {
    const names: string[] = [];
    for (let level = this.top; level >= this.bottom; level--) {
      names.push(this.types.filter((t) => t.level === level).map((t) => t.name).join('/'));
    }
    return names.join(', ');
  }
}

const DEFAULT_LEVELS = new Levels();

/**
 * The issue type a new Agilefant item becomes, by what its parent is in
 * Jira: a top-level item is an epic, any other one level below its parent.
 * Null below the lowest level, where it has to be fitted in by planMove.
 */
export function jiraTypeForNewItem(parentType: string | null | undefined, levels: Levels = DEFAULT_LEVELS): string | null {
  if (!parentType) return levels.top >= 1 ? levels.defaultAt(1) : levels.defaultAt(0);
  const level = levels.of(parentType) - 1;
  return level < levels.bottom ? null : levels.defaultAt(level);
}

/** Where an issue ends up after a move: its type and its parent. */
export interface Placement {
  id: string;
  type: string;
  parent: string | null;
}

export type MovePlan = { placements: Placement[] } | { impossible: string };

/**
 * What a move in Agilefant's hierarchy asks of Jira. Agilefant nests as deep
 * as anyone likes and has no types; in Jira each issue's type says its level,
 * and a child sits exactly one level below its parent.
 *
 * So the tree the issue lands in is levelled again from its top: the top
 * keeps its level if the tree fits under it, and is raised as far as the tree
 * needs; every issue below sits one level under its parent. That raises a
 * task to an epic when a third level appears under it, an epic to the level
 * above when a fourth does, and lowers an epic to a story when it is put
 * under another epic — its tasks becoming subtasks.
 *
 * Returns, top-down, the issues whose type or parent changes; or why the
 * tree cannot fit, when it needs more levels than Jira has.
 */
export function planMove(
  issues: ReadonlyMap<string, { type: string; parent: string | null }>,
  moved: string,
  parent: string | null,
  levels: Levels = DEFAULT_LEVELS,
): MovePlan {
  const parentOf = (id: string) => (id === moved ? parent : issues.get(id)?.parent ?? null);
  for (let p = parent, n = 0; p; p = parentOf(p), n++) {
    if (p === moved || n > 50) return { impossible: 'it would be under itself' };
  }
  let top = moved;
  for (let p = parentOf(top); p && issues.has(p); p = parentOf(top)) top = p;

  const children = new Map<string, string[]>();
  for (const id of new Set([...issues.keys(), moved])) {
    const p = parentOf(id);
    if (p) children.set(p, [...(children.get(p) ?? []), id]);
  }
  // Top-down, with each issue's depth below the top.
  const order: Array<[string, number]> = [[top, 0]];
  for (let i = 0; i < order.length; i++) {
    const [id, depth] = order[i];
    for (const child of children.get(id) ?? []) order.push([child, depth + 1]);
  }
  const height = Math.max(...order.map(([, depth]) => depth));
  if (height + 1 > levels.count) {
    return {
      impossible: `Jira has ${levels.count} levels — ${levels.describe()} — and this would make ${height + 1}; move something up first`,
    };
  }
  const typeOf = (id: string) => issues.get(id)?.type ?? levels.defaultAt(0);
  // Never a subtask at the top, never lower than the tree needs.
  const topLevel = Math.max(levels.of(typeOf(top)), levels.bottom + height, 0);
  const placements: Placement[] = [];
  for (const [id, depth] of order) {
    const type = levels.typeAt(topLevel - depth, typeOf(id));
    if (type !== typeOf(id) || id === moved) placements.push({ id, type, parent: parentOf(id) });
  }
  return { placements };
}

/**
 * The types every issue of a hierarchy should have, as the sync levels them:
 * each tree from its top, the top keeping its level if the tree fits under
 * it and raised as far as it needs, everything else one level under its
 * parent. A tree too deep for Jira keeps the types it has — the sync refuses
 * the move that made it so.
 *
 * What the app shows the moment an item is moved in Agilefant, before Jira
 * has made the change: planMove on the tree the item lands in gives the same
 * types, every other tree being levelled already.
 *
 * An item not in Jira yet (no type) gets the type the sync will make it:
 * the level under its parent, as jiraTypeForNewItem says — an epic at the
 * top — and where there is none under its parent, a task the tree is then
 * raised to hold, as createUnderSubtask does. Levelled with the rest, that is
 * what the sync's creating and moving come to.
 */
export function expectedTypes(
  issues: ReadonlyMap<string, { type: string | null; parent: string | null }>,
  levels: Levels = DEFAULT_LEVELS,
): Map<string, string> {
  const children = new Map<string, string[]>();
  const tops: string[] = [];
  for (const [id, issue] of issues) {
    if (issue.parent && issues.has(issue.parent)) children.set(issue.parent, [...(children.get(issue.parent) ?? []), id]);
    else tops.push(id);
  }
  const out = new Map<string, string>();
  for (const top of tops) {
    const order: Array<[string, number]> = [[top, 0]];
    for (let i = 0; i < order.length && i < 10_000; i++) {
      const [id, depth] = order[i];
      for (const child of children.get(id) ?? []) order.push([child, depth + 1]);
    }
    const height = Math.max(...order.map(([, depth]) => depth));
    if (height + 1 > levels.count) {
      // Too deep for Jira: the sync leaves its types, and makes nothing new in it.
      for (const [id] of order) {
        const type = issues.get(id)?.type;
        if (type) out.set(id, type);
      }
      continue;
    }
    // Parents before children: a new item's type follows its parent's.
    const typeOf = new Map<string, string>();
    for (const [id] of order) {
      const own = issues.get(id)?.type;
      const parent = issues.get(id)?.parent;
      const parentType = parent ? typeOf.get(parent) : undefined;
      typeOf.set(id, own ?? jiraTypeForNewItem(parentType, levels) ?? levels.defaultAt(0));
    }
    const topLevel = Math.max(levels.of(typeOf.get(top)!), levels.bottom + height, 0);
    for (const [id, depth] of order) out.set(id, levels.typeAt(topLevel - depth, typeOf.get(id)!));
  }
  return out;
}

// ─── Deciding ────────────────────────────────────────────────────────────────

/** Two states equal, field by field. */
export function sameState(a: SyncState | null | undefined, b: SyncState | null | undefined): boolean {
  if (!a || !b) return a === b;
  return SYNCED_FIELDS.every((field) => a[field] === b[field]);
}

export interface Reconciled {
  /** The state both sides should hold. */
  state: SyncState;
  /** Fields the Agilefant item has to be given. */
  toAgilefant: SyncedField[];
  /** Fields the Jira issue has to be given. */
  toJira: SyncedField[];
}

/**
 * What to do with a pair, field by field. A field changed on one side since
 * the last agreed state is taken from that side; changed on both, from the
 * side changed later; changed on neither, left alone. With no agreed state
 * yet (a pair just made), Jira's is the starting point for every field the
 * two disagree on, unless Agilefant is the later.
 */
export function reconcile(
  agreed: SyncState | null,
  agilefant: SyncState,
  jira: SyncState,
  agilefantChangedAt: number | null,
  jiraChangedAt: number | null,
): Reconciled {
  const state = { ...jira };
  const toAgilefant: SyncedField[] = [];
  const toJira: SyncedField[] = [];
  const agilefantIsLater = (agilefantChangedAt ?? 0) > (jiraChangedAt ?? 0);
  for (const field of SYNCED_FIELDS) {
    if (agilefant[field] === jira[field]) {
      (state as Record<SyncedField, unknown>)[field] = jira[field];
      continue;
    }
    const agilefantMoved = !agreed || agilefant[field] !== agreed[field];
    const jiraMoved = !agreed || jira[field] !== agreed[field];
    const takeAgilefant = agilefantMoved && (!jiraMoved || agilefantIsLater);
    if (takeAgilefant) {
      (state as Record<SyncedField, unknown>)[field] = agilefant[field];
      toJira.push(field);
    } else {
      (state as Record<SyncedField, unknown>)[field] = jira[field];
      toAgilefant.push(field);
    }
  }
  return { state, toAgilefant, toJira };
}
