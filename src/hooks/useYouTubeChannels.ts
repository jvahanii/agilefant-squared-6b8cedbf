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

/**
 * Attempts to resolve the URL of the most recently uploaded video for the
 * channel by fetching its YouTube RSS feed.  Returns `null` if the channel
 * ID cannot be determined from the stored URL or if the network request
 * fails for any reason (including CORS restrictions in some environments).
 *
 * Callers should fall back to `getChannelVideoUrl` when this returns `null`.
 */
export async function fetchLatestVideoUrl(channel: YouTubeChannel): Promise<string | null> {
  const url = /^https?:\/\//i.test(channel.url) ? channel.url : `https://${channel.url}`;

  // Only works for /channel/UCxxxxxxxx URLs where we can derive the channel ID
  const channelIdMatch = url.match(/\/channel\/(UC[a-zA-Z0-9_-]+)/i);
  if (!channelIdMatch) return null;

  const channelId = channelIdMatch[1];
  const rssUrl = `https://www.youtube.com/feeds/videos.xml?channel_id=${channelId}`;
  // Use a CORS proxy so the browser can read the XML response
  const proxyUrl = `https://corsproxy.io/?url=${encodeURIComponent(rssUrl)}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 5000);
  try {
    const response = await fetch(proxyUrl, { signal: controller.signal });
    if (!response.ok) return null;
    const text = await response.text();
    const doc = new DOMParser().parseFromString(text, "text/xml");
    // The feed's first <entry> has an <id> like "yt:video:VIDEO_ID"
    const idText = doc.querySelector("entry > id")?.textContent ?? "";
    const videoId = idText.split(":").pop();
    if (!videoId) return null;
    return `https://www.youtube.com/watch?v=${videoId}`;
  } catch {
    return null;
  } finally {
    clearTimeout(timeoutId);
  }
}
