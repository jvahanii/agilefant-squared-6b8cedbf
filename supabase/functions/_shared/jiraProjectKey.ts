// A Jira space made for an Agilefant list: the key and name it is given.
//
// Jira's rules: a key is an uppercase letter and then uppercase letters or
// digits, at most ten in all, and unique on the site; so is a name. Shared by
// the edge function, which makes the space, and the app, which proposes them.

/** What Jira takes as a project key. */
export const PROJECT_KEY = /^[A-Z][A-Z0-9]{1,9}$/;

/**
 * A key for a space named `name`, not one of `taken`: the initials of a name
 * of several words ("Fitness input" → FI), the first letters of a name of one
 * ("Backlog" → BACK), with a number after it where that is taken (FI2).
 */
export function suggestProjectKey(name: string, taken: Iterable<string> = []): string {
  const ascii = name.normalize('NFKD').replace(/[̀-ͯ]/g, '').toUpperCase();
  const words = ascii.split(/[^A-Z0-9]+/).filter(Boolean);
  let base = words.length >= 2 ? words.map((w) => w[0]).join('') : (words[0] ?? '').slice(0, 4);
  base = base.replace(/^[0-9]+/, '');
  if (!base) base = 'LIST';
  if (base.length < 2) base = (base + (words.join('').replace(/^[0-9]+/, '').slice(1) || 'X')).slice(0, 4);
  base = base.slice(0, 8);
  const used = new Set([...taken].map((k) => k.toUpperCase()));
  if (!used.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const key = base.slice(0, 10 - String(n).length) + n;
    if (!used.has(key)) return key;
  }
  return base;
}

/** The name, or the name with a number after it where a space has it already. */
export function uniqueProjectName(name: string, taken: Iterable<string> = []): string {
  const used = new Set([...taken].map((n) => n.trim().toLowerCase()));
  const plain = name.trim() || 'Agilefant list';
  if (!used.has(plain.toLowerCase())) return plain;
  for (let n = 2; n < 1000; n++) {
    const next = `${plain} (${n})`;
    if (!used.has(next.toLowerCase())) return next;
  }
  return plain;
}
