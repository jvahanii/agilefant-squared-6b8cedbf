// Splitting rules for incoming WhatsApp messages.
//
// Historically a message was always split on line breaks. Each integration can
// now configure which characters start a new work item, so a single-line
// "milk, bread, eggs" can arrive as three items while other chats keep the
// line-break-only behaviour.

export interface SplitRules {
  splitOnNewline: boolean;
  splitOnSpace: boolean;
  /** Extra characters to split on, e.g. ",;/" — whitespace in the field is ignored. */
  delimiters: string;
  minFragmentLength: number;
}

export const defaultSplitRules: SplitRules = {
  splitOnNewline: true,
  splitOnSpace: false,
  delimiters: '',
  minFragmentLength: 1,
};

function escapeForClass(ch: string): string {
  return ch.replace(/[\\\]^-]/g, (m) => `\\${m}`);
}

/**
 * Split a message body into work item titles according to the rules.
 * With no rules enabled the whole message becomes a single item.
 */
export function splitMessage(body: string, rules: Partial<SplitRules> = {}): string[] {
  const r = { ...defaultSplitRules, ...rules };
  const chars = new Set<string>();
  if (r.splitOnNewline) { chars.add('\n'); chars.add('\r'); }
  if (r.splitOnSpace) { chars.add(' '); chars.add('\t'); }
  for (const ch of r.delimiters ?? '') {
    // Whitespace in the custom field is treated as separation between the
    // characters the user typed, not as a delimiter itself — spaces have their
    // own switch.
    if (!ch.trim()) continue;
    chars.add(ch);
  }

  const min = Math.max(1, Number(r.minFragmentLength) || 1);
  const raw = chars.size === 0
    ? [body]
    : body.split(new RegExp(`[${[...chars].map(escapeForClass).join('')}]`));

  return raw
    .map((s) => s.trim())
    .filter((s) => s.length >= min);
}

/** A MacroDroid token such as {not_text_lines}: ASCII word characters in braces. */
const PLACEHOLDER = /\{[a-z_][a-z0-9_]*\}/gi;

/**
 * Is this line an automation placeholder that was sent unfilled?
 *
 * MacroDroid fills {not_text_lines} and its kind from the notification that
 * fired the macro. Run by hand — Test macro, Test action — there is no
 * notification, and the braces go out as written: "{not_text_lines}" arrived as
 * a shopping-list item. A line counts when, placeholders taken out, nothing but
 * spacing and punctuation is left, so "{not_title}: {not_text}" counts too.
 *
 * Only ASCII identifiers, so a real message in braces — "{tärkeä}" — is kept.
 */
export function isUnfilledPlaceholder(line: string): boolean {
  const tokens = line.match(PLACEHOLDER);
  if (!tokens) return false;
  return line.replace(PLACEHOLDER, "").replace(/[\s\p{P}]/gu, "") === "";
}

/**
 * The sender as the notification titled it, without WhatsApp's unread count.
 *
 * A group notification is titled "Kauppalista (2 viestiä): Paula Nikolainen" —
 * the count changes with every message and says nothing about who wrote it, yet
 * it went into each item's description. Taken out only where it sits: a number
 * and a word in parentheses, right before the colon or the end. A group named
 * "Budget (2024)" keeps its year, having no word after the number.
 */
export function senderWithoutUnreadCount(name: string): string {
  return name.replace(/\s*\(\d+\s+[^()]+\)(?=\s*(?::|$))/u, "").trim();
}
