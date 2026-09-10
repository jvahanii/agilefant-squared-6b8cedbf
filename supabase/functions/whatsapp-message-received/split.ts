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
