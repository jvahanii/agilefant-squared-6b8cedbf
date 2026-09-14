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
