/**
 * Scrambles a name using ROT-13 substitution so that letters become unreadable
 * while preserving the overall visual structure (spaces, punctuation, digits).
 */
export function scrambleName(name: string): string {
  if (!name) return name;
  return name.replace(/[a-zA-Z]/g, (c) => {
    const base = c >= "a" ? 97 : 65;
    return String.fromCharCode(((c.charCodeAt(0) - base + 13) % 26) + base);
  });
}
