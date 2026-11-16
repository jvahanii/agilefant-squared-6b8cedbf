/** At most this many items from one paste, so a stray paste of a whole document stays undoable at a glance. */
export const MAX_PASTED_ITEMS = 100;

// A list copied from a note, a document or an email keeps its markers:
// "- ", "* ", "• ", "1. ", "2) ", "[ ] ", "- [x] ". They are not part of the title.
const MARKER = /^(?:[-*•–+]\s+)?(?:\d{1,3}[.)]\s+)?(?:\[[ xX]?\]\s+)?/;

/** Each non-empty line of a typed or pasted text as an item title, without list markers. */
export function itemLines(text: string): string[] {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim().replace(MARKER, "").trim())
    .filter(Boolean);
}
