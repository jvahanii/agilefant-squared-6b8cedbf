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
const API_KEY_STORAGE_KEY = "youtubeApiKey";

export function getYouTubeApiKey(): string {
  // The YouTube Data API key is a public browser-side credential (restricted by
  // referer/IP in the Google Cloud Console) and is intentionally stored in
  // localStorage as plain text, consistent with other per-browser settings in
  // this app.
  return localStorage.getItem(API_KEY_STORAGE_KEY) ?? "";
}

export function setYouTubeApiKey(key: string) {
  if (key.trim()) {
    localStorage.setItem(API_KEY_STORAGE_KEY, key.trim());
  } else {
    localStorage.removeItem(API_KEY_STORAGE_KEY);
  }
}

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

/** Maximum ms to wait for any single YouTube API request. */
const FETCH_TIMEOUT_MS = 5000;

const YT_API_BASE = "https://www.googleapis.com/youtube/v3";

/**
 * Resolves the UCxxxxxxxx channel ID for a given channel URL fragment using
 * the YouTube Data API v3.  Handles the following formats:
 *   - /channel/UCxxxxxxxx  → returned as-is
 *   - /user/USERNAME       → resolved via channels?forUsername=
 *   - /@handle             → resolved via channels?forHandle=
 *
 * Returns `null` when the API key is missing, the API returns an error, or the
 * channel cannot be found.
 */
async function resolveChannelId(baseUrl: string, apiKey: string): Promise<string | null> {
  // Direct channel ID – no API call needed
  const channelIdMatch = baseUrl.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/i);
  if (channelIdMatch) return channelIdMatch[1];

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    let searchParam: string;
    const handleMatch = baseUrl.match(/\/@([a-zA-Z0-9_-]+)/i);
    const userMatch = baseUrl.match(/\/user\/([a-zA-Z0-9_-]+)/i);

    if (handleMatch) {
      searchParam = `forHandle=${encodeURIComponent(handleMatch[1])}`;
    } else if (userMatch) {
      searchParam = `forUsername=${encodeURIComponent(userMatch[1])}`;
    } else {
      return null;
    }

    const url = `${YT_API_BASE}/channels?part=id&${searchParam}&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const json = await response.json();
    return (json?.items?.[0]?.id as string) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Fetches the most recently uploaded video ID for the given channel using the
 * YouTube Data API v3 search endpoint.  Returns `null` on any error.
 */
async function fetchLatestVideoIdFromApi(channelId: string, apiKey: string): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url =
      `${YT_API_BASE}/search?part=id&channelId=${encodeURIComponent(channelId)}` +
      `&type=video&order=date&maxResults=1&key=${encodeURIComponent(apiKey)}`;
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return null;
    const json = await response.json();
    return (json?.items?.[0]?.id?.videoId as string) ?? null;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * Attempts to resolve the URL of the most recently uploaded video for the
 * channel using the YouTube Data API v3.  Returns `null` if:
 *   - no YouTube API key has been configured (via setYouTubeApiKey)
 *   - the channel cannot be resolved
 *   - the API request fails for any reason
 *
 * Callers should fall back to `getChannelVideoUrl` when this returns `null`.
 */
export async function fetchLatestVideoUrl(channel: YouTubeChannel): Promise<string | null> {
  const apiKey = getYouTubeApiKey();
  if (!apiKey) return null;

  const rawUrl = /^https?:\/\//i.test(channel.url) ? channel.url : `https://${channel.url}`;

  // Already a specific video – return as-is
  if (/\/watch\?/i.test(rawUrl) || /youtu\.be\//i.test(rawUrl)) {
    return rawUrl;
  }

  // Strip to the base channel URL (remove any subpage like /videos, /streams, etc.)
  const baseUrl = rawUrl
    .replace(/\/(videos|streams|playlists|community|about|featured).*$/, "")
    .replace(/\/+$/, "");

  const channelId = await resolveChannelId(baseUrl, apiKey);
  if (!channelId) return null;

  const videoId = await fetchLatestVideoIdFromApi(channelId, apiKey);
  if (!videoId) return null;

  return `https://www.youtube.com/watch?v=${videoId}`;
}
