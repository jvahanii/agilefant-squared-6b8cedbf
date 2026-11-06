import { toIsoDate } from "@/lib/deadlineFormat";
import type { WorkItem } from "@/types/models";
import { dueDay } from "@/lib/searchFilters";

/**
 * What the search box finds, and in what order.
 *
 * A query is words and commands. Every word has to be found in an item — in
 * any order, in its name, its Jira key, a label, its description or one of its
 * links — and every command has to hold for it:
 *
 *   /due today     /due this week     /overdue
 *   /open          /done              /scrambled
 *   /label urgent  /team design       /rated 4+   ("/label "very urgent"" for spaces)
 *
 * Capitals and accents do not matter ("tyopaikka" finds "työpaikka"), and a
 * word of four letters or more is found with a letter wrong, missing, extra
 * or swapped ("recieve" finds "receive").
 *
 * The best matches come first: the name exactly, then names starting with
 * what was typed, then names holding it, then the other places. Open items
 * before done ones, and recently changed ones before those left alone: a
 * little for a change this month, more this week, most today. Among equals,
 * the most recently changed first; then by name.
 */

// ─── Folding ─────────────────────────────────────────────────────────────────

/**
 * Lower case without accents, as long as the text it came from, so that a
 * place found in the folded text is the same place in the original.
 */
export function fold(text: string): string {
  // eslint-disable-next-line no-control-regex
  if (/^[\x00-\x7f]*$/.test(text)) return text.toLowerCase();
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const folded = ch.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();
    out += folded.length === 1 ? folded : ch.length === 1 && ch.toLowerCase().length === 1 ? ch.toLowerCase() : ch;
  }
  return out;
}

const foldedOnce = new Map<string, string>();
/** fold, remembered: names and descriptions are folded on every keystroke otherwise. */
function folded(text: string): string {
  let out = foldedOnce.get(text);
  if (out === undefined) {
    out = fold(text);
    if (foldedOnce.size > 50_000) foldedOnce.clear();
    foldedOnce.set(text, out);
  }
  return out;
}

// ─── Commands ────────────────────────────────────────────────────────────────

export interface SearchContext {
  now?: Date;
  jiraKey?: (itemId: string) => string | undefined;
  scrambled?: { has(itemId: string): boolean };
  labelNames?: (itemId: string) => string[];
  teamNames?: (itemId: string) => string[];
  links?: (itemId: string) => Array<{ url: string; altText?: string }>;
  /** When the item last changed, in milliseconds (itemChangedAt.ts). */
  changedAt?: (item: Item) => number | undefined;
}

type Item = Pick<WorkItem, "id" | "title" | "status" | "deadline"> & Partial<Pick<WorkItem, "description" | "rating">>;

interface Command {
  /** As written: "/due today". */
  text: string;
  holds(item: Item, ctx: SearchContext): boolean;
  /** "No items are due today", when it is the only thing asked. */
  nothingFound: string;
}

/** The commands, for the suggestions shown while one is being typed. */
export const SEARCH_COMMANDS: Array<{ usage: string; insert: string; description: string }> = [
  { usage: "/due today", insert: "/due today", description: "Deadline is today" },
  { usage: "/due this week", insert: "/due this week", description: "Deadline is this week, Monday to Sunday" },
  { usage: "/overdue", insert: "/overdue", description: "Deadline has passed and the item is not done" },
  { usage: "/open", insert: "/open", description: "Not done" },
  { usage: "/done", insert: "/done", description: "Done" },
  { usage: "/label name", insert: "/label ", description: "Has a label starting with the name" },
  { usage: "/team name", insert: "/team ", description: "Assigned to a team starting with the name" },
  { usage: "/rated 4+", insert: "/rated ", description: "Rated 4 or more; /rated 4 for exactly 4" },
  { usage: "/scrambled", insert: "/scrambled", description: "Name is scrambled" },
];

function mondayOf(day: Date): Date {
  const monday = new Date(day.getFullYear(), day.getMonth(), day.getDate());
  monday.setDate(monday.getDate() - ((monday.getDay() + 6) % 7));
  return monday;
}

// ─── Parsing ─────────────────────────────────────────────────────────────────

export interface ParsedQuery {
  /** Folded words, each to be found. */
  words: string[];
  commands: Command[];
  /** Commands not understood, as typed: "/due tom". */
  unknown: string[];
  /** Is there anything to search for? */
  active: boolean;
}

/** Words, with "quoted words" kept together. */
function tokens(query: string): string[] {
  const out: string[] = [];
  const re = /"([^"]*)"?|(\S+)/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(query))) {
    const token = m[1] !== undefined ? m[1].trim() : m[2];
    if (token) out.push(token);
  }
  return out;
}

export function parseQuery(query: string, now: Date = new Date()): ParsedQuery {
  const words: string[] = [];
  const commands: Command[] = [];
  const unknown: string[] = [];
  const parts = tokens(query);
  for (let i = 0; i < parts.length; i++) {
    const part = parts[i];
    if (!part.startsWith("/")) {
      words.push(fold(part));
      continue;
    }
    const name = part.slice(1).toLowerCase();
    const next = parts[i + 1];
    const nextLower = next?.toLowerCase();
    if (name === "due" && nextLower === "today") {
      const today = toIsoDate(now);
      commands.push({ text: "/due today", holds: (item) => dueDay(item, now) === today, nothingFound: "No items are due today" });
      i += 1;
    } else if (name === "due" && nextLower === "this" && parts[i + 2]?.toLowerCase() === "week") {
      const monday = mondayOf(now);
      const sunday = new Date(monday);
      sunday.setDate(monday.getDate() + 6);
      const from = toIsoDate(monday);
      const to = toIsoDate(sunday);
      commands.push({
        text: "/due this week",
        holds: (item) => {
          const day = dueDay(item, now);
          return day !== undefined && day >= from && day <= to;
        },
        nothingFound: "No items are due this week",
      });
      i += 2;
    } else if (name === "overdue") {
      const today = toIsoDate(now);
      commands.push({
        text: "/overdue",
        holds: (item) => {
          const day = dueDay(item, now);
          return item.status !== "done" && day !== undefined && day < today;
        },
        nothingFound: "No items are overdue",
      });
    } else if (name === "open") {
      commands.push({ text: "/open", holds: (item) => item.status !== "done", nothingFound: "No items are open" });
    } else if (name === "done") {
      commands.push({ text: "/done", holds: (item) => item.status === "done", nothingFound: "No items are done" });
    } else if (name === "scrambled") {
      commands.push({
        text: "/scrambled",
        holds: (item, ctx) => ctx.scrambled?.has(item.id) ?? false,
        nothingFound: "No items are scrambled",
      });
    } else if ((name === "label" || name === "team") && next && !next.startsWith("/")) {
      const wanted = fold(next);
      const namesOf = (item: Item, ctx: SearchContext) =>
        (name === "label" ? ctx.labelNames : ctx.teamNames)?.(item.id) ?? [];
      commands.push({
        text: `/${name} ${next}`,
        holds: (item, ctx) => namesOf(item, ctx).some((n) => folded(n).startsWith(wanted)),
        nothingFound: `No items have a ${name} called “${next}”`,
      });
      i += 1;
    } else if (name === "rated" && next && /^[0-5]\+?$/.test(next)) {
      const at = Number(next[0]);
      const orMore = next.endsWith("+");
      commands.push({
        text: `/rated ${next}`,
        holds: (item) => item.rating !== undefined && (orMore ? item.rating >= at : item.rating === at),
        nothingFound: orMore ? `No items are rated ${at} or more` : `No items are rated ${at}`,
      });
      i += 1;
    } else if (name === "due") {
      // Half typed — "/due tod", "/due this we" — and not words to look for.
      let typed = part;
      while (parts[i + 1] && /^(t|to|tod|toda|today|th|thi|this|w|we|wee|week)$/i.test(parts[i + 1])) typed += ` ${parts[++i]}`;
      unknown.push(typed);
    } else {
      const takesArgument = ["label", "team", "rated"].includes(name) && next && !next.startsWith("/");
      unknown.push(takesArgument ? `${part} ${next}` : part);
      if (takesArgument) i += 1;
    }
  }
  const wordsLength = words.join("").length;
  return { words, commands, unknown, active: commands.length > 0 || wordsLength >= 2 };
}

/** The command being typed at the end of the query, for suggestions: "/du" → "/du". */
export function commandBeingTyped(query: string): string | null {
  const m = /(?:^|\s)(\/[a-z]*(?: [a-z]*)?(?: [a-z]*)?)$/i.exec(query);
  if (!m) return null;
  const typed = m[1].toLowerCase();
  // A finished command needs no suggestion.
  const finished = SEARCH_COMMANDS.some((c) => c.insert.trim() === typed.trim() && !c.insert.endsWith(" "));
  return finished ? null : typed;
}

export function suggestCommands(typed: string) {
  const t = typed.trim().toLowerCase();
  return SEARCH_COMMANDS.filter((c) => c.usage.startsWith(t) || c.insert.startsWith(t) || t.startsWith(c.insert.trim()));
}

// ─── Matching ────────────────────────────────────────────────────────────────

/** Edit distance with swaps, given up on beyond `max`. */
function closeEnough(a: string, b: string, max: number): boolean {
  if (Math.abs(a.length - b.length) > max) return false;
  const rows = a.length + 1;
  const cols = b.length + 1;
  let prevPrev: number[] = [];
  let prev = Array.from({ length: cols }, (_, j) => j);
  for (let i = 1; i < rows; i++) {
    const cur = [i];
    let rowMin = i;
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let v = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) v = Math.min(v, prevPrev[j - 2] + 1);
      cur.push(v);
      if (v < rowMin) rowMin = v;
    }
    if (rowMin > max) return false;
    prevPrev = prev;
    prev = cur;
  }
  return prev[cols - 1] <= max;
}

const WORD = /[\p{L}\p{N}]+/gu;
const isWordChar = (ch: string | undefined) => ch !== undefined && /[\p{L}\p{N}]/u.test(ch);

type Hit = { at: number; length: number; quality: "start" | "inside" | "fuzzy" };

/** The words of a folded text and where they start, remembered. */
const wordsOnce = new Map<string, Array<[string, number]>>();
function wordsOf(text: string): Array<[string, number]> {
  let out = wordsOnce.get(text);
  if (!out) {
    out = [...text.matchAll(WORD)].filter((m) => m[0].length >= 3).map((m) => [m[0], m.index!] as [string, number]);
    if (wordsOnce.size > 50_000) wordsOnce.clear();
    wordsOnce.set(text, out);
  }
  return out;
}

/**
 * Where a folded word is in a folded text: as it is, or — in a name or a
 * label, where a slip matters most and costs least — nearly.
 */
function find(text: string, word: string, nearly = true): Hit | null {
  let best: Hit | null = null;
  for (let at = text.indexOf(word); at >= 0; at = text.indexOf(word, at + 1)) {
    const quality = isWordChar(text[at - 1]) ? "inside" : "start";
    if (quality === "start") return { at, length: word.length, quality };
    best ??= { at, length: word.length, quality };
  }
  if (best || !nearly || word.length < 4) return best;
  const max = word.length >= 8 ? 2 : 1;
  for (const [token, at] of wordsOf(text)) {
    // The whole word, or its start: "recieve" in "receiver".
    if (closeEnough(word, token, max)) return { at, length: token.length, quality: "fuzzy" };
    if (token.length > word.length && closeEnough(word, token.slice(0, word.length), max)) {
      return { at, length: word.length, quality: "fuzzy" };
    }
  }
  return null;
}

/** Where words were found in a name, to mark them. */
export type Ranges = Array<[number, number]>;

export interface NameMatch {
  score: number;
  ranges: Ranges;
}

const NAME_SCORE = { start: 30, inside: 20, fuzzy: 10 } as const;

/** A name holding every word; for lists, and the first place looked in an item. */
export function matchName(name: string, words: string[]): NameMatch | null {
  const text = folded(name);
  let score = 0;
  const ranges: Ranges = [];
  for (const word of words) {
    const hit = find(text, word);
    if (!hit) return null;
    score += NAME_SCORE[hit.quality];
    ranges.push([hit.at, hit.at + hit.length]);
  }
  return { score: score + nameBonus(text, words, ranges), ranges };
}

/**
 * How well the name as a whole answers: it is what was typed, or starts with
 * it, or holds it as typed; or it is the same words in another order; and the
 * more of it the words make up, the better — "Budget plan" before "A plan for
 * the budget" — and a name starting with one of them before others.
 */
function nameBonus(text: string, words: string[], ranges: Ranges): number {
  if (words.length === 0) return 0;
  const phrase = words.join(" ");
  const name = text.trim();
  let bonus = 0;
  if (name === phrase) bonus += 100;
  else if (name.startsWith(phrase)) bonus += 40;
  else if (name.includes(phrase)) bonus += 15;
  else {
    const nameWords = name.match(WORD) ?? [];
    if (nameWords.length === words.length && [...nameWords].sort().join(" ") === [...words].sort().join(" ")) bonus += 80;
  }
  if (ranges.length > 0) {
    const letters = name.replace(/\s+/g, "").length || 1;
    const covered = ranges.reduce((sum, [from, to]) => sum + (to - from), 0);
    bonus += Math.round(20 * Math.min(1, covered / letters));
    if (ranges.some(([from]) => from === text.length - text.trimStart().length)) bonus += 10;
  }
  return bonus;
}

export type MatchedIn = "name" | "key" | "label" | "description" | "link";

export interface ItemMatch {
  score: number;
  /** When the item last changed, for ordering equal matches; 0 when not known. */
  changedAt: number;
  /** In the name, to mark. */
  ranges: Ranges;
  /** The other places a word was found, with a piece of the text around it. */
  elsewhere: Array<{ in: Exclude<MatchedIn, "name">; snippet: string }>;
}

const OTHER_SCORE: Record<Exclude<MatchedIn, "name">, number> = { key: 25, label: 12, description: 8, link: 6 };

const plainOnce = new Map<string, string>();
function plainDescription(description: string): string {
  let out = plainOnce.get(description);
  if (out === undefined) {
    out = stripMarkup(description);
    if (plainOnce.size > 20_000) plainOnce.clear();
    plainOnce.set(description, out);
  }
  return out;
}

function stripMarkup(description: string): string {
  return description.replace(/<[^>]+>/g, " ").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
}

function snippetAround(text: string, hit: Hit): string {
  const from = Math.max(0, hit.at - 30);
  const to = Math.min(text.length, hit.at + hit.length + 50);
  return `${from > 0 ? "…" : ""}${text.slice(from, to).trim()}${to < text.length ? "…" : ""}`;
}

/** Does the item answer the query, and how well? */
export function matchItem(item: Item, query: ParsedQuery, ctx: SearchContext = {}): ItemMatch | null {
  for (const command of query.commands) if (!command.holds(item, ctx)) return null;
  const name = folded(item.title);
  let score = 0;
  const ranges: Ranges = [];
  const elsewhere: ItemMatch["elsewhere"] = [];
  for (const word of query.words) {
    const hit = find(name, word);
    if (hit) {
      score += NAME_SCORE[hit.quality];
      ranges.push([hit.at, hit.at + hit.length]);
      continue;
    }
    const found = findElsewhere(item, word, ctx);
    if (!found) return null;
    score += OTHER_SCORE[found.in];
    if (!elsewhere.some((e) => e.in === found.in && e.snippet === found.snippet)) elsewhere.push(found);
  }
  score += nameBonus(name, query.words, ranges);
  if (item.status !== "done") score += 15;
  const changedAt = ctx.changedAt?.(item) ?? 0;
  score += recencyBonus(changedAt, (ctx.now ?? new Date()).getTime());
  return { score, changedAt, ranges, elsewhere };
}

const DAY_MS = 24 * 60 * 60_000;

/** Changed today, this week or this month: enough to order like matches, not to lift a poor one over a good one. */
export function recencyBonus(changedAt: number, now: number): number {
  if (!changedAt) return 0;
  const age = now - changedAt;
  if (age < DAY_MS) return 10;
  if (age < 7 * DAY_MS) return 6;
  if (age < 30 * DAY_MS) return 3;
  return 0;
}

function findElsewhere(item: Item, word: string, ctx: SearchContext): ItemMatch["elsewhere"][number] | null {
  const key = ctx.jiraKey?.(item.id);
  if (key && folded(key).includes(word)) return { in: "key", snippet: key };
  for (const label of ctx.labelNames?.(item.id) ?? []) {
    if (find(folded(label), word)) return { in: "label", snippet: label };
  }
  if (item.description) {
    const text = plainDescription(item.description);
    const hit = find(folded(text), word, false);
    if (hit) return { in: "description", snippet: snippetAround(text, hit) };
  }
  for (const link of ctx.links?.(item.id) ?? []) {
    const text = [link.altText, link.url].filter(Boolean).join(" ");
    if (find(folded(text), word, false)) return { in: "link", snippet: link.altText || link.url };
  }
  return null;
}

/** What to say when nothing is found. */
export function nothingFound(query: ParsedQuery, typed: string): string {
  if (query.words.length === 0 && query.commands.length === 1) return query.commands[0].nothingFound;
  return `No items match “${typed.trim()}”`;
}
