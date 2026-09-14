// Shaping the Gmail import picker's rows. Kept out of the component file so
// Fast Refresh keeps working there, and so the grouping can be unit-tested.

export interface PreviewLink {
  url: string;
  title: string;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  alreadyImported: boolean;
  /** yyyy-mm-dd, when the mail stated an application deadline. */
  deadline?: string;
  /** The mail said applications stay open, as opposed to saying nothing. */
  deadlineOpen?: boolean;
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
  /** Rows currently listed. */
  shown: number;
  /** Source emails those rows came from. */
  emails: number;
  mode: "links" | "jobs";
  /** Rows before the keyword filter, when one is active. */
  total?: number;
}): string {
  const noun = opts.mode === "jobs" ? "job" : "link";
  const items = `${opts.shown} ${noun}${opts.shown === 1 ? "" : "s"}`;
  const emails = `${opts.emails} email${opts.emails === 1 ? "" : "s"}`;
  const filtered =
    opts.total !== undefined && opts.total !== opts.shown ? ` (filtered from ${opts.total})` : "";
  return `${items} found in ${emails}${filtered} — pick what to import`;
}

/**
 * What the picker shows about a posting's closing date.
 *
 * Three states, deliberately distinct: a date, explicitly open-ended, and not
 * known. Most sources state nothing in the mail, and those are filled in at
 * import by fetching the posting -- so "unknown" here means "not yet", not
 * "none".
 */
export function deadlineLabel(link: { deadline?: string; deadlineOpen?: boolean }): string {
  if (link.deadline) {
    const d = new Date(link.deadline);
    return Number.isNaN(d.getTime()) ? link.deadline : `closes ${d.toLocaleDateString()}`;
  }
  if (link.deadlineOpen) return "open until further notice";
  return "deadline unknown";
}
