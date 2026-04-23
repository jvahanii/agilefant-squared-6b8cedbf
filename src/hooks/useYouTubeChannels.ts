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
