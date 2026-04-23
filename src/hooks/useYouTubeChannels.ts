export type YouTubeVideoSelection = "latest" | "oldest" | "popular";

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
 * Returns a YouTube URL that navigates to the channel's video listing.
 * All selections fall back to the default newest-first /videos page because
 * YouTube's URL-based sort parameters are unreliable; the `fetchLatestVideoUrl`
 * function uses the YouTube Data API to resolve the correct video for "oldest"
 * and "popular" selections.
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

  return `${base}/videos`;
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
 * Fetches a video ID for the given channel using the YouTube Data API v3 search
 * endpoint, sorted by the given order.  Returns `null` on any error.
 */
async function fetchVideoIdFromApi(
  channelId: string,
  apiKey: string,
  order: "date" | "viewCount",
): Promise<string | null> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const url =
      `${YT_API_BASE}/search?part=id&channelId=${encodeURIComponent(channelId)}` +
      `&type=video&order=${order}&maxResults=1&key=${encodeURIComponent(apiKey)}`;
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
 * Fetches the oldest uploaded video ID for the given channel by paginating
 * through the channel's uploads playlist (newest-first) until the last page.
 *
 * Strategy:
 *   1. Fetch the first page (maxResults=1) to read `pageInfo.totalResults`.
 *   2. Calculate the total number of full pages needed using maxResults=50.
 *   3. Follow `nextPageToken` until the last page is reached, then return the
 *      last video ID on that page.
 *
 * Returns `null` on any error or when the playlist cannot be found.
 */
async function fetchOldestVideoIdFromApi(channelId: string, apiKey: string): Promise<string | null> {
  // The uploads playlist ID is derived from the channel ID by replacing the
  // "UC" prefix with "UU".
  if (!channelId.startsWith("UC")) return null;
  const uploadsPlaylistId = "UU" + channelId.substring(2);

  // Step 1: fetch first page (1 result) to learn the total video count.
  const PAGE_SIZE = 50;
  let totalResults = 0;
  {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const url =
        `${YT_API_BASE}/playlistItems?part=contentDetails` +
        `&playlistId=${encodeURIComponent(uploadsPlaylistId)}` +
        `&maxResults=1&key=${encodeURIComponent(apiKey)}`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) return null;
      const json = await response.json();
      totalResults = (json?.pageInfo?.totalResults as number) ?? 0;
      if (totalResults === 0) return null;
    } catch {
      return null;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  // Step 2: paginate with maxResults=50 until we reach the last page.
  const totalPages = Math.ceil(totalResults / PAGE_SIZE);
  let pageToken: string | undefined;
  let lastVideoId: string | null = null;

  for (let page = 0; page < totalPages; page++) {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      let url =
        `${YT_API_BASE}/playlistItems?part=contentDetails` +
        `&playlistId=${encodeURIComponent(uploadsPlaylistId)}` +
        `&maxResults=${PAGE_SIZE}&key=${encodeURIComponent(apiKey)}`;
      if (pageToken) url += `&pageToken=${encodeURIComponent(pageToken)}`;
      const response = await fetch(url, { signal: controller.signal });
      if (!response.ok) break;
      const json = await response.json();
      const items: { contentDetails?: { videoId?: string } }[] = json?.items ?? [];
      if (items.length > 0) {
        const id = items[items.length - 1]?.contentDetails?.videoId;
        if (id) lastVideoId = id;
      }
      if (!json?.nextPageToken) break;
      pageToken = json.nextPageToken as string;
    } catch {
      break;
    } finally {
      clearTimeout(timeoutId);
    }
  }

  return lastVideoId;
}

/**
 * Attempts to resolve a direct video URL for the channel using the YouTube
 * Data API v3, honouring the channel's `videoSelection`:
 *
 *   - "latest"   → most recently uploaded video (`order=date`)
 *   - "popular"  → most-viewed video (`order=viewCount`)
 *   - "oldest"                  → oldest uploaded video (uploads-playlist pagination)
 *
 * Returns `null` if:
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

  const selection = channel.videoSelection ?? DEFAULT_VIDEO_SELECTION;
  let videoId: string | null;
  switch (selection) {
    case "popular":
      videoId = await fetchVideoIdFromApi(channelId, apiKey, "viewCount");
      break;
    case "oldest":
      videoId = await fetchOldestVideoIdFromApi(channelId, apiKey);
      break;
    case "latest":
    default:
      videoId = await fetchVideoIdFromApi(channelId, apiKey, "date");
      break;
  }

  if (!videoId) return null;
  return `https://www.youtube.com/watch?v=${videoId}`;
}
