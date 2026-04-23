export type YouTubeVideoSelection = "latest" | "oldest" | "popular" | "latest-video";

export const DEFAULT_VIDEO_SELECTION: YouTubeVideoSelection = "latest";

export interface YouTubeChannel {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
  videoSelection?: YouTubeVideoSelection;
}

const STORAGE_KEY = "youtubeChannels";

function getChannels(): YouTubeChannel[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function saveChannels(channels: YouTubeChannel[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(channels));
}

export function getYouTubeChannels(): YouTubeChannel[] {
  return getChannels();
}

export function addYouTubeChannel(
  name: string,
  url: string,
  videoSelection: YouTubeVideoSelection = DEFAULT_VIDEO_SELECTION,
): YouTubeChannel {
  const channels = getChannels();
  const id =
    typeof crypto !== "undefined" && typeof crypto.randomUUID === "function"
      ? crypto.randomUUID()
      : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  const channel: YouTubeChannel = {
    id,
    name,
    url,
    enabled: true,
    videoSelection,
  };
  saveChannels([...channels, channel]);
  return channel;
}

export function removeYouTubeChannel(id: string) {
  saveChannels(getChannels().filter((c) => c.id !== id));
}

export function toggleYouTubeChannel(id: string) {
  saveChannels(getChannels().map((c) => (c.id === id ? { ...c, enabled: !c.enabled } : c)));
}

export function setYouTubeChannelVideoSelection(id: string, videoSelection: YouTubeVideoSelection) {
  saveChannels(getChannels().map((c) => (c.id === id ? { ...c, videoSelection } : c)));
}

export function getEnabledYouTubeChannels(): YouTubeChannel[] {
  return getChannels().filter((c) => c.enabled);
}

/**
 * Returns a YouTube URL that navigates to the channel's video listing
 * sorted according to the channel's `videoSelection` setting, rather
 * than landing on the channel's front page.
 *
 * - "latest"  → /videos          (newest-first, YouTube default)
 * - "popular" → /videos?view=0&sort=p
 * - "oldest"  → /videos?view=0&sort=da
 *
 * If the stored URL is already a direct video URL (watch / youtu.be),
 * it is returned unchanged.
 */
export function getChannelVideoUrl(channel: YouTubeChannel): string {
  const url = /^https?:\/\//i.test(channel.url) ? channel.url : `https://${channel.url}`;

  // Already a specific video – return as-is
  if (/\/watch\?/i.test(url) || /youtu\.be\//i.test(url)) {
    return url;
  }

  // Strip any existing subpage suffix so we always start from the channel root
  const base = url
    .replace(/\/(videos|streams|playlists|community|about|featured).*$/, "")
    .replace(/\/+$/, "");

  switch (channel.videoSelection ?? DEFAULT_VIDEO_SELECTION) {
    case "popular":
      return `${base}/videos?view=0&sort=p`;
    case "oldest":
      return `${base}/videos?view=0&sort=da`;
    case "latest-video":
    case "latest":
    default:
      return `${base}/videos`;
  }
}

/** Maximum ms to wait for any single CORS-proxy network request. */
const FETCH_TIMEOUT_MS = 5000;

/**
 * Fetches the first video ID from a YouTube RSS feed URL using a CORS proxy.
 * Returns `null` if the request fails or no video entry is found.
 */
async function fetchFirstVideoIdFromRss(rssUrl: string): Promise<string | null> {
  const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(rssUrl)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(proxyUrl, { signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    const doc = new DOMParser().parseFromString(text, "text/xml");
    // Each <entry> has an <id> like "yt:video:VIDEO_ID"
    const idText = doc.querySelector("entry > id")?.textContent ?? "";
    const videoId = idText.split(":").pop();
    return videoId || null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches the channel page via CORS proxy and extracts the YouTube channel ID
 * from the embedded JSON-LD / page data.  Used as a fallback for @handle URLs.
 */
async function resolveChannelIdFromPage(channelUrl: string): Promise<string | null> {
  const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(channelUrl)}`;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const response = await fetch(proxyUrl, { signal: controller.signal });
    if (!response.ok) return null;
    const html = await response.text();
    const match = html.match(/"channelId":"(UC[a-zA-Z0-9_-]+)"/);
    return match ? match[1] : null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Attempts to resolve the URL of the most recently uploaded video for the
 * channel by fetching its YouTube RSS feed.  Returns `null` if the channel
 * cannot be resolved or if the network request fails for any reason
 * (including CORS restrictions in some environments).
 *
 * Supports the following channel URL formats:
 *   - /channel/UCxxxxxxxx  (direct channel ID)
 *   - /user/USERNAME       (legacy username)
 *   - /@handle             (modern @handle — resolved via page scrape)
 *
 * Callers should fall back to `getChannelVideoUrl` when this returns `null`.
 */
export async function fetchLatestVideoUrl(channel: YouTubeChannel): Promise<string | null> {
  const rawUrl = /^https?:\/\//i.test(channel.url) ? channel.url : `https://${channel.url}`;

  // Already a specific video – return as-is
  if (/\/watch\?/i.test(rawUrl) || /youtu\.be\//i.test(rawUrl)) {
    return rawUrl;
  }

  // Strip to the base channel URL (remove any subpage like /videos, /streams, etc.)
  const baseUrl = rawUrl
    .replace(/\/(videos|streams|playlists|community|about|featured).*$/, "")
    .replace(/\/+$/, "");

  // /channel/UCxxxxxxxx → use channel_id RSS feed directly
  const channelIdMatch = baseUrl.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/i);
  if (channelIdMatch) {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelIdMatch[1]}`;
    const videoId = await fetchFirstVideoIdFromRss(rssUrl);
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return null;
  }

  // /user/USERNAME → use user= RSS feed
  const userMatch = baseUrl.match(/\/user\/([a-zA-Z0-9_-]+)/i);
  if (userMatch) {
    const rssUrl = `https://www.youtube.com/feeds/videos.xml?user=${userMatch[1]}`;
    const videoId = await fetchFirstVideoIdFromRss(rssUrl);
    if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    return null;
  }

  // /@handle → try user= RSS first (works when handle matches a legacy username),
  // then fall back to scraping the channel page to extract the channel ID.
  const handleMatch = baseUrl.match(/\/@([a-zA-Z0-9_-]+)/i);
  if (handleMatch) {
    const handle = handleMatch[1];

    // Attempt 1: user-based RSS (quick, no extra page fetch needed)
    const userRssUrl = `https://www.youtube.com/feeds/videos.xml?user=${handle}`;
    const videoIdFromUser = await fetchFirstVideoIdFromRss(userRssUrl);
    if (videoIdFromUser) return `https://www.youtube.com/watch?v=${videoIdFromUser}`;

    // Attempt 2: scrape the channel page to get the UC* channel ID
    const channelId = await resolveChannelIdFromPage(baseUrl);
    if (channelId) {
      const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
      const videoId = await fetchFirstVideoIdFromRss(rssUrl);
      if (videoId) return `https://www.youtube.com/watch?v=${videoId}`;
    }
  }

  return null;
}
