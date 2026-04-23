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
    case "latest":
    default:
      return `${base}/videos`;
  }
}
