/**
 * Registry of :shortcode: → emoji mappings used by IconizedTitle.
 * Titles are stored as plain text with :name: tokens; the render layer
 * replaces those tokens with the corresponding emoji in-place.
 *
 * Add new entries here — no DB changes needed.
 */
export const ICON_MAP: Record<string, string> = {
  heart: "❤️",
  bug: "🐛",
  star: "⭐",
  rocket: "🚀",
  check: "✅",
  fire: "🔥",
  warning: "⚠️",
  lightbulb: "💡",
  lock: "🔒",
  sparkles: "✨",
  exclamation: "❗",
  bookmark: "🔖",
  clock: "🕐",
  money: "💰",
  chart: "📊",
  mail: "📧",
  phone: "📞",
  house: "🏠",
  gear: "⚙️",
  globe: "🌐",
  bulb: "💡",
  zap: "⚡",
  shield: "🛡️",
  key: "🔑",
  hammer: "🔨",
  wrench: "🔧",
  truck: "🚚",
  package: "📦",
  trash: "🗑️",
  memo: "📝",
  eyes: "👀",
  brain: "🧠",
  speech: "💬",
  pin: "📌",
  link: "🔗",
  flag: "🚩",
  target: "🎯",
  hourglass: "⏳",
  calendar: "📅",
  construction: "🚧",
  recycle: "♻️",
  plus: "➕",
  minus: "➖",
  question: "❓",
  info: "ℹ️",
  idea: "💡",
  thumbsup: "👍",
  thumbsdown: "👎",
  clap: "👏",
  pray: "🙏",
  muscle: "💪",
  rainbow: "🌈",
  gift: "🎁",
  party: "🎉",
  microphone: "🎤",
  camera: "📷",
  video: "🎬",
  book: "📖",
  pencil: "✏️",
  magnet: "🧲",
  scissors: "✂️",
  pushpin: "📌",
  bell: "🔔",
  no_bell: "🔕",
  bed: "🛏️",
  pill: "💊",
  syringe: "💉",
  bandage: "🩹",
  ambulance: "🚑",
  police: "🚔",
  firefighter: "🚒",
  cloud: "☁️",
  sun: "☀️",
  moon: "🌙",
  umbrella: "☂️",
  snowflake: "❄️",
  tornado: "🌪️",
  droplet: "💧",
  leaf: "🍃",
  seedling: "🌱",
  tree: "🌳",
  earth: "🌍",
  anchor: "⚓",
  airplane: "✈️",
  train: "🚆",
  bus: "🚌",
  bicycle: "🚲",
  walking: "🚶",
  running: "🏃",
  swim: "🏊",
  basketball: "🏀",
  soccer: "⚽",
  tennis: "🎾",
  golf: "⛳",
  medal: "🏅",
  trophy: "🏆",
  dart: "🎯",
  gamepad: "🎮",
  music: "🎵",
  art: "🎨",
  theater: "🎭",
  microscope: "🔬",
  telescope: "🔭",
  satellite: "🛰️",
  atom: "⚛️",
  dna: "🧬",
  pill_bottle: "💊",
};

/** All available icon shortcodes (sorted) for the picker. */
export const ICON_SHORTCODES = Object.keys(ICON_MAP).sort();

/** Regex that matches :word: tokens (word chars only, no spaces/case-insensitive-looking). */
const ICON_REGEX = /:([a-zA-Z_]+):/g;

export type ParsedSegment =
  | { kind: "text"; value: string }
  | { kind: "icon"; shortcode: string; emoji: string };

/**
 * Parse a title string into an array of text/icon segments.
 * Unknown shortcodes are left as raw text.
 */
export function parseIcons(title: string): ParsedSegment[] {
  const segments: ParsedSegment[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  const re = new RegExp(ICON_REGEX);
  while ((match = re.exec(title)) !== null) {
    if (match.index > lastIndex) {
      segments.push({ kind: "text", value: title.slice(lastIndex, match.index) });
    }
    const shortcode = match[1].toLowerCase();
    const emoji = ICON_MAP[shortcode];
    if (emoji) {
      segments.push({ kind: "icon", shortcode, emoji });
    } else {
      // Unknown shortcode → keep as raw text
      segments.push({ kind: "text", value: match[0] });
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < title.length) {
    segments.push({ kind: "text", value: title.slice(lastIndex) });
  }
  return segments;
}