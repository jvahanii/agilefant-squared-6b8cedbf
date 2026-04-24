export interface YouTubeChannel {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

export type YouTubeSearchOrder = "relevance" | "date" | "viewCount";

export const DEFAULT_SEARCH_ORDER: YouTubeSearchOrder = "relevance";

export interface YouTubeSearchChannel {
  id: string;
  name: string;
  keywords: string;
  searchOrder: YouTubeSearchOrder;
  enabled: boolean;
}

const CHANNELS_KEY = "youtubeChannels";
const SEARCH_CHANNELS_KEY = "youtubeSearchChannels";

// ---------------------------------------------------------------------------
// Regular channels
// ---------------------------------------------------------------------------

function getChannels(): YouTubeChannel[] {
  try {
    // Strip legacy videoSelection field on read
    const raw: (YouTubeChannel & { videoSelection?: unknown })[] = JSON.parse(
      localStorage.getItem(CHANNELS_KEY) || "[]",
    );
    return raw.map(({ videoSelection: _vs, ...rest }) => rest);
  } catch {
    return [];
  }
}

function saveChannels(channels: YouTubeChannel[]) {
  localStorage.setItem(CHANNELS_KEY, JSON.stringify(channels));
}

export function getYouTubeChannels(): YouTubeChannel[] {
  return getChannels();
}

export function addYouTubeChannel(name: string, url: string): YouTubeChannel {
  const channels = getChannels();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const channel: YouTubeChannel = { id, name, url, enabled: true };
  saveChannels([...channels, channel]);
  return channel;
}

export function removeYouTubeChannel(id: string) {
  saveChannels(getChannels().filter((c) => c.id !== id));
}

export function toggleYouTubeChannel(id: string) {
  saveChannels(getChannels().map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
}

export function renameYouTubeChannel(id: string, name: string) {
  saveChannels(getChannels().map((c) => (c.id === id ? { ...c, name } : c)));
}

export function getEnabledYouTubeChannels(): YouTubeChannel[] {
  return getChannels().filter((c) => c.enabled);
}

// ---------------------------------------------------------------------------
// Video links
// ---------------------------------------------------------------------------

export interface YouTubeVideoLink {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

const VIDEO_LINKS_KEY = "youtubeVideoLinks";

function getVideoLinks(): YouTubeVideoLink[] {
  try {
    return JSON.parse(localStorage.getItem(VIDEO_LINKS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveVideoLinks(links: YouTubeVideoLink[]) {
  localStorage.setItem(VIDEO_LINKS_KEY, JSON.stringify(links));
}

export function getYouTubeVideoLinks(): YouTubeVideoLink[] {
  return getVideoLinks();
}

export function addYouTubeVideoLink(name: string, url: string): YouTubeVideoLink {
  const links = getVideoLinks();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const link: YouTubeVideoLink = { id, name, url, enabled: true };
  saveVideoLinks([...links, link]);
  return link;
}

export function removeYouTubeVideoLink(id: string) {
  saveVideoLinks(getVideoLinks().filter((l) => l.id !== id));
}

export function toggleYouTubeVideoLink(id: string) {
  saveVideoLinks(getVideoLinks().map((l) => (l.id === id ? { ...l, enabled: !l.enabled } : l)));
}

export function renameYouTubeVideoLink(id: string, name: string) {
  saveVideoLinks(getVideoLinks().map((l) => (l.id === id ? { ...l, name } : l)));
}

export function getEnabledYouTubeVideoLinks(): YouTubeVideoLink[] {
  return getVideoLinks().filter((l) => l.enabled);
}

/**
 * Returns the raw URL for a video link, normalizing missing protocol.
 */
export function getVideoLinkUrl(link: YouTubeVideoLink): string {
  return /^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`;
}

// ---------------------------------------------------------------------------

/**
 * Returns the channel's /videos page URL.
 * If the stored URL is already a direct video URL it is returned unchanged.
 */
export function getChannelVideoUrl(channel: YouTubeChannel): string {
  const url = /^https?:\/\//i.test(channel.url) ? channel.url : `https://${channel.url}`;

  if (/\/watch\?/i.test(url) || /youtu\.be\//i.test(url)) {
    return url;
  }

  const base = url
    .replace(/\/(videos|streams|playlists|community|about|featured).*$/, "")
    .replace(/\/+$/, "");

  return `${base}/videos`;
}

// ---------------------------------------------------------------------------
// Search channels
// ---------------------------------------------------------------------------

function getSearchChannels(): YouTubeSearchChannel[] {
  try {
    return JSON.parse(localStorage.getItem(SEARCH_CHANNELS_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveSearchChannels(channels: YouTubeSearchChannel[]) {
  localStorage.setItem(SEARCH_CHANNELS_KEY, JSON.stringify(channels));
}

export function getYouTubeSearchChannels(): YouTubeSearchChannel[] {
  return getSearchChannels();
}

export function addYouTubeSearchChannel(
  name: string,
  keywords: string,
  searchOrder: YouTubeSearchOrder = DEFAULT_SEARCH_ORDER,
): YouTubeSearchChannel {
  const channels = getSearchChannels();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const channel: YouTubeSearchChannel = { id, name, keywords, searchOrder, enabled: true };
  saveSearchChannels([...channels, channel]);
  return channel;
}

export function removeYouTubeSearchChannel(id: string) {
  saveSearchChannels(getSearchChannels().filter((c) => c.id !== id));
}

export function toggleYouTubeSearchChannel(id: string) {
  saveSearchChannels(
    getSearchChannels().map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)),
  );
}

export function setYouTubeSearchChannelOrder(id: string, searchOrder: YouTubeSearchOrder) {
  saveSearchChannels(
    getSearchChannels().map((c) => (c.id === id ? { ...c, searchOrder } : c)),
  );
}

export function renameYouTubeSearchChannel(id: string, name: string) {
  saveSearchChannels(getSearchChannels().map((c) => (c.id === id ? { ...c, name } : c)));
}

/**
 * Returns a YouTube search URL for the given search channel.
 * Sorting is done via YouTube's `sp` URL parameter (no API key required).
 *
 *   relevance  – default YouTube sort (no sp param)
 *   date       – CAI= (sort by upload date, most recent first)
 *   viewCount  – CAM= (sort by view count, most popular first)
 */
export function getSearchChannelUrl(channel: YouTubeSearchChannel): string {
  const query = encodeURIComponent(channel.keywords);
  const base = `https://www.youtube.com/results?search_query=${query}`;
  switch (channel.searchOrder) {
    case "date":
      return `${base}&sp=CAI%3D`;
    case "viewCount":
      return `${base}&sp=CAM%3D`;
    default:
      return base;
  }
}
