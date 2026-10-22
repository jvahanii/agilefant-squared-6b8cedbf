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
export function textToAdf(text: string | null | undefined): AdfNode | null {
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
  return { type: 'doc', attrs: { version: 1 }, content } as AdfNode & { attrs: { version: number } };
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

/**
 * The Jira issue type a new Agilefant item becomes, by what its parent is in
 * Jira: a top-level item is an epic, a child of an epic a task, a child of a
 * task or story a subtask. Jira has nothing below a subtask, so an item there
 * is not sent (null).
 */
export function jiraTypeForNewItem(parentType: string | null | undefined): string | null {
  if (!parentType) return 'Epic';
  if (parentType === 'Epic') return 'Task';
  if (parentType === 'Task' || parentType === 'Story' || parentType === 'Bug') return 'Subtask';
  return null;
}

/**
 * The issue type an issue must have to sit under this parent, given the type
 * it has now. Agilefant has no types, so a move in its hierarchy can ask for
 * something Jira only allows of another type: a task under a task must be a
 * subtask, an epic under an epic a story, a subtask at the top level a task.
 * Null where Jira has no place for it at all — under a subtask.
 */
export function jiraTypeUnder(parentType: string | null | undefined, currentType: string): string | null {
  const standard = (type: string) => type === 'Task' || type === 'Story' || type === 'Bug';
  if (!parentType) return currentType === 'Subtask' ? 'Task' : currentType;
  if (parentType === 'Epic') return standard(currentType) ? currentType : currentType === 'Epic' ? 'Story' : 'Task';
  if (standard(parentType)) return 'Subtask';
  return null;
}

/** Jira's three levels: an epic, above a task or story, above a subtask. */
export function levelOf(type: string): number {
  return type === 'Epic' ? 2 : type === 'Subtask' ? 0 : 1;
}

/** The type for a level, keeping the current one where the level is the same. */
function typeAt(level: number, current: string): string {
  if (level === levelOf(current)) return current;
  if (level === 2) return 'Epic';
  if (level === 0) return 'Subtask';
  // A lowered epic becomes a story, a raised subtask a task.
  return current === 'Epic' ? 'Story' : 'Task';
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
 * as anyone likes and has no types; Jira has three levels, each issue's type
 * saying which, and a child exactly one level below its parent.
 *
 * So the tree the issue lands in is levelled again from its top: the top
 * keeps its level if the tree fits under it, and is raised as far as the tree
 * needs; every issue below sits one level under its parent. That raises a
 * task to an epic when a third level appears under it, and lowers an epic to
 * a story when it is put under another epic — its tasks becoming subtasks.
 *
 * Returns, top-down, the issues whose type or parent changes; or why the
 * tree cannot fit, when it would need more than three levels.
 */
export function planMove(
  issues: ReadonlyMap<string, { type: string; parent: string | null }>,
  moved: string,
  parent: string | null,
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
  if (height > 2) {
    return {
      impossible: `Jira has three levels — epic, task or story, subtask — and this would make ${height + 1}; move something up first`,
    };
  }
  const typeOf = (id: string) => issues.get(id)?.type ?? 'Task';
  // Never a subtask at the top, never lower than the tree needs.
  const topLevel = Math.max(levelOf(typeOf(top)), height, 1);
  const placements: Placement[] = [];
  for (const [id, depth] of order) {
    const type = typeAt(topLevel - depth, typeOf(id));
    if (type !== typeOf(id) || id === moved) placements.push({ id, type, parent: parentOf(id) });
  }
  return { placements };
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
