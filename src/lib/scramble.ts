/**
 * Moomin characters and story-themed words used for funny scrambling.
 * Sourced from Tove Jansson's Moomin universe.
 */
const MOOMIN_WORDS = [
  "Moomintroll",
  "Moominmamma",
  "Moominpappa",
  "Snorkmaiden",
  "Snork",
  "Sniff",
  "LittleMy",
  "Mymble",
  "Snufkin",
  "Hemulen",
  "Fillyjonk",
  "TooTicky",
  "Groke",
  "Hattifattener",
  "Fuzzy",
  "Hobgoblin",
  "Ancestor",
  "Moominvalley",
  "Moominhouse",
  "Nibling",
  "Whomper",
  "Inspector",
  "Salome",
  "Misabel",
  "Edwardian",
  "Oomph",
  "Joxter",
  "Muddler",
  "Muskrat",
  "Nymphaea",
];

/**
 * Returns a stable numeric hash for a string (djb2 variant).
 * Input is normalised to lowercase so that capitalisation variants of the
 * same word always map to the same Moomin word.
 *
 * Math.imul is used for multiplication so that the arithmetic stays within
 * 32-bit integer bounds — matching the djb2 spec and avoiding floating-point
 * precision loss that would otherwise shift the word mapping for longer inputs.
 */
function hashString(s: string): number {
  const lower = s.toLowerCase();
  let h = 5381;
  for (let i = 0; i < lower.length; i++) {
    h = Math.imul(h, 33) ^ lower.charCodeAt(i);
  }
  // Treat as unsigned 32-bit value so the modulo is always non-negative.
  return h >>> 0;
}

/**
 * Scrambles a name by replacing each word (sequence of letters) with a
 * deterministically chosen Moomin character or story word, while preserving
 * digits, spaces, and punctuation so the visual structure is maintained.
 */
export function scrambleName(name: string): string {
  if (!name) return name;
  return name.replace(/[a-zA-Z]+/g, (word) => {
    const moomin = MOOMIN_WORDS[hashString(word) % MOOMIN_WORDS.length];
    // Preserve the original word's capitalisation style.
    // A word is considered ALL-CAPS only when it has more than one character
    // and every letter is uppercase (avoids misclassifying single uppercase
    // letters like "I" or "A" as all-caps runs).
    const isAllCaps = word.length > 1 && word === word.toUpperCase();
    if (isAllCaps) {
      return moomin.toUpperCase();
    }
    if (word[0] === word[0].toUpperCase()) {
      return moomin.charAt(0).toUpperCase() + moomin.slice(1);
    }
    return moomin.toLowerCase();
  });
}
