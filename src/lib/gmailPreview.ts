// Shaping the Gmail import picker's rows. Kept out of the component file so
// Fast Refresh keeps working there, and so the grouping can be unit-tested.

import { deadlinePassed } from "../../supabase/functions/_shared/deadlines";

export interface PreviewLink {
  url: string;
  title: string;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  alreadyImported: boolean;
  /** The backlog it is already in, when the tree was searched. */
  alreadyIn?: string | null;
  /** yyyy-mm-dd, when the mail stated an application deadline. */
  deadline?: string;
  /** The mail said applications stay open, as opposed to saying nothing. */
  deadlineOpen?: boolean;
  /** The posting has stopped taking applications. Shown, but not pre-selected. */
  applicationsClosed?: boolean;
  /**
   * Where the job is, read from the posting page. Empty: read, no city named.
   * Absent: not read yet, and the import will read it.
   */
  cities?: string[];
  /** Status the imported item should start with; absent means not_started. */
  status?: string;
}

export interface SourceEmailGroup {
  messageId: string;
  subject: string;
  from: string;
  date: string;
  links: PreviewLink[];
}

/** "Duunitori <duunivahti@duunitori.fi>" -> "Duunitori". Falls back to the address. */
export function senderName(from: string): string {
  const display = from.split("<")[0].replace(/["']/g, "").trim();
  if (display && !display.includes("@")) return display;
  return from.replace(/^.*<|>.*$/g, "").trim() || from;
}

/**
 * The address out of "Name <a@b.c>". Empty when the header carries no display
 * name, because senderName() already returns the address in that case and the
 * picker would otherwise print it twice.
 */
export function senderAddress(from: string): string {
  const match = from.match(/<([^>]+)>/);
  if (!match) return "";
  const display = from.split("<")[0].replace(/["']/g, "").trim();
  return display && !display.includes("@") ? match[1].trim() : "";
}

/** Opens the source message in Gmail. The API message id works as the fragment. */
export function gmailMessageUrl(messageId: string): string {
  return `https://mail.google.com/mail/u/0/#all/${messageId}`;
}

/**
 * Group postings under the email they came from, preserving the order they
 * arrived in. A digest contributes a dozen rows at once; flat, they look like
 * they appeared from nowhere.
 */
export function groupBySourceEmail(links: PreviewLink[]): SourceEmailGroup[] {
  const byMessage = new Map<string, SourceEmailGroup>();
  for (const l of links) {
    const existing = byMessage.get(l.messageId);
    if (existing) existing.links.push(l);
    else
      byMessage.set(l.messageId, {
        messageId: l.messageId,
        subject: l.subject || "(no subject)",
        from: l.from ?? "",
        date: l.date ?? "",
        links: [l],
      });
  }
  return [...byMessage.values()];
}

/**
 * The line above the picker. Built as a string rather than inline JSX: the
 * pluralisation and the spacing between interpolations are easy to get wrong
 * in markup and impossible to test there.
 */
export function previewSummary(opts: {
  /** Distinct postings currently listed; one in three emails counts once. */
  shown: number;
  /** Source emails those rows came from. */
  emails: number;
  mode: "links" | "jobs";
  /** Distinct postings before the keyword filter, when one is active. */
  total?: number;
  /**
   * Of the rows listed, those that started ticked -- the ones startingReason
   * found nothing against, so one per new posting. Ticking by hand does not
   * change it.
   */
  fresh?: number;
}): string {
  const noun = opts.mode === "jobs" ? "job" : "link";
  const items = `${opts.shown} ${noun}${opts.shown === 1 ? "" : "s"}`;
  const fresh =
    opts.fresh !== undefined && opts.shown > 0
      ? `, out of which ${opts.fresh} seem${opts.fresh === 1 ? "s" : ""} new,`
      : "";
  const emails = `${opts.emails} email${opts.emails === 1 ? "" : "s"}`;
  const filtered =
    opts.total !== undefined && opts.total !== opts.shown ? ` (filtered from ${opts.total})` : "";
  return `${items}${fresh} found in ${emails}${filtered} — pick what to import`;
}

/**
 * What the picker shows about a posting's closing date.
 *
 * Three states, deliberately distinct: a date, explicitly open-ended, and not
 * known. Most sources state nothing in the mail, and those are filled in at
 * import by fetching the posting -- so "unknown" here means "not yet", not
 * "none".
 */
/**
 * Why a posting is not ticked for import, or null when it is ticked.
 *
 * The picker un-ticks a row rather than hiding it, and an un-ticked row with no
 * visible reason looks like a mistake. Every reason the picker acts on is named
 * here, so the list cannot un-tick a row for a reason it does not show.
 */
export function uncheckedReason(
  link: {
    deadline?: string;
    applicationsClosed?: boolean;
    alreadyImported?: boolean;
    alreadyIn?: string | null;
  },
  now: Date | number = Date.now(),
): string | null {
  if (link.alreadyImported) return link.alreadyIn ? `already in ${link.alreadyIn}` : "already imported";
  if (link.applicationsClosed) return "no longer accepting applications";
  if (deadlinePassed(link.deadline, now)) return "the closing date has passed";
  return null;
}

/**
 * A row's cities, kept to one short line: "Helsinki, Joensuu +8 more". The
 * whole list goes in the row's tooltip. Written out in full, a posting open
 * in ten cities ran the width of the dialog and read as the row's main point.
 */
export function cityLine(cities: readonly string[]): string {
  const more = cities.length - 2;
  return `${cities.slice(0, 2).join(", ")}${more > 0 ? ` +${more} more` : ""}`;
}

/** A picker row's identity: the same posting in two emails is two rows. */
export const rowKey = (link: { messageId: string; url: string }) => `${link.messageId}|${link.url}`;

/**
 * The one row that stands for each posting: the first copy that states a
 * closing date, since that date becomes part of the item's name and decides
 * where auto-place files it; otherwise simply the first. `links` is in display
 * order, newest email first, so "first" means "most recent".
 *
 * Both the unticking and the folding below hang off this one rule, so it lives
 * here rather than twice.
 */
export function keptCopies(links: PreviewLink[]): Map<string, PreviewLink> {
  const kept = new Map<string, PreviewLink>();
  for (const link of links) {
    const current = kept.get(link.url);
    if (!current || (!current.deadline && link.deadline)) kept.set(link.url, link);
  }
  return kept;
}

/**
 * For each kept row, the other emails that carried the same posting.
 *
 * The picker folds those other copies away rather than listing them, so this is
 * what is left to say about them: how many there were, and which subjects, for
 * the row's tooltip. Keyed by the *kept* row — the opposite of `repeatedRows`,
 * which keys the copies being dropped.
 */
export function repeatedElsewhere(
  links: PreviewLink[],
): Map<string, { count: number; subjects: string[] }> {
  const kept = keptCopies(links);
  const seen = new Map<string, Set<string>>();
  const others = new Map<string, { count: number; subjects: string[] }>();
  for (const link of links) {
    const keeper = kept.get(link.url)!;
    // The kept row itself, and a second copy inside the same email: neither is
    // another email carrying the posting.
    if (keeper.messageId === link.messageId) continue;
    const key = rowKey(keeper);
    // Counted by email, not by subject: LinkedIn sends the same subject several
    // times a day, and those are different emails.
    const messages = seen.get(key) ?? new Set<string>();
    if (messages.has(link.messageId)) continue;
    messages.add(link.messageId);
    seen.set(key, messages);
    const entry = others.get(key) ?? { count: 0, subjects: [] };
    entry.count += 1;
    const subject = link.subject || "(no subject)";
    if (!entry.subjects.includes(subject)) entry.subjects.push(subject);
    others.set(key, entry);
  }
  return others;
}

/** What a folded row says: `also in 2 other emails`. */
export function alsoInLabel(count: number): string {
  return `also in ${count} other email${count === 1 ? "" : "s"}`;
}

/**
 * Rows that repeat a posting another row already lists, with the email of the
 * copy that is kept.
 *
 * Alerts overlap — LinkedIn re-sends a role several times a day, and a company
 * digest repeats one a board has already mailed — and the import merges
 * rows with the same link into a single item anyway. Ticking every copy only
 * made the picker overstate how much was new. `links` is in display order,
 * newest email first. The copy that stays ticked is the most recent one that
 * states a closing date, or the most recent one when none does.
 */
export function repeatedRows(links: PreviewLink[]): Map<string, string> {
  const kept = keptCopies(links);
  const repeats = new Map<string, string>();
  for (const link of links) {
    const keeper = kept.get(link.url)!;
    // Twice in one email is the same row key as the kept copy, so marking it
    // would untick that one as well. The import merges those regardless.
    if (keeper.messageId === link.messageId) continue;
    repeats.set(rowKey(link), `also in "${keeper.subject}"`);
  }
  return repeats;
}

/** Why a row starts unticked — its own reason first, then being a repeat. */
export function startingReason(
  link: PreviewLink,
  repeats: Map<string, string>,
  now: Date | number = Date.now(),
): string | null {
  return uncheckedReason(link, now) ?? repeats.get(rowKey(link)) ?? null;
}

/** Distinct postings among these rows, however many emails list each. */
export const distinctJobs = (links: { url: string }[]) => new Set(links.map((l) => l.url)).size;

/**
 * Where an email's already-imported jobs are, for its heading: "2 already in
 * Jobs with no deadline, 1 in Jobs with deadline". It used to say "in this
 * backlog", but the check covers the whole tree, so the jobs are as often in a
 * neighbouring list. Falls back to "already imported" when a row does not say
 * which list, and is empty when none are.
 */
export function alreadyInSummary(links: { alreadyImported: boolean; alreadyIn?: string | null }[]): string {
  const seen = links.filter((l) => l.alreadyImported);
  if (seen.length === 0) return "";
  if (seen.some((l) => !l.alreadyIn)) return `${seen.length} already imported`;
  const perList = new Map<string, number>();
  for (const l of seen) perList.set(l.alreadyIn!, (perList.get(l.alreadyIn!) ?? 0) + 1);
  return [...perList]
    .map(([list, count], i) => `${count} ${i === 0 ? "already " : ""}in ${list}`)
    .join(", ");
}

export function deadlineLabel(link: {
  deadline?: string;
  deadlineOpen?: boolean;
  applicationsClosed?: boolean;
}): string {
  // A closed posting outranks whatever date it carried: the date is moot once
  // nobody can apply.
  if (link.applicationsClosed) return "no longer accepting applications";
  if (link.deadline) {
    const d = new Date(link.deadline);
    return Number.isNaN(d.getTime()) ? link.deadline : `closes ${d.toLocaleDateString()}`;
  }
  if (link.deadlineOpen) return "open until further notice";
  return "deadline unknown";
}
