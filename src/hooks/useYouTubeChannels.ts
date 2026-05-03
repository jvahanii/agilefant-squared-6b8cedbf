import { supabase } from "@/integrations/supabase/client";

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

export interface YouTubeVideoLink {
  id: string;
  name: string;
  url: string;
  enabled: boolean;
}

// Legacy localStorage keys (used only for one-time migration)
const CHANNELS_KEY = "youtubeChannels";
const SEARCH_CHANNELS_KEY = "youtubeSearchChannels";
const VIDEO_LINKS_KEY = "youtubeVideoLinks";
const MIGRATION_FLAG_PREFIX = "youtubeMigrated:";

// ---------------------------------------------------------------------------
// One-time per-org migration from localStorage to Supabase
// ---------------------------------------------------------------------------

async function migrateLegacyDataIfNeeded(orgId: string): Promise<void> {
  const flagKey = `${MIGRATION_FLAG_PREFIX}${orgId}`;
  if (typeof localStorage === "undefined") return;
  if (localStorage.getItem(flagKey)) return;

  // Set the flag synchronously before any async work so that concurrent callers
  // (e.g. getYouTubeChannels / getYouTubeSearchChannels / getYouTubeVideoLinks
  // all invoked in the same tick) see it immediately and skip the migration,
  // preventing the same localStorage data from being inserted multiple times.
  localStorage.setItem(flagKey, "1");

  try {
    const channelsRaw = localStorage.getItem(CHANNELS_KEY);
    const searchRaw = localStorage.getItem(SEARCH_CHANNELS_KEY);
    const videosRaw = localStorage.getItem(VIDEO_LINKS_KEY);

    const channels: { name: string; url: string; enabled?: boolean }[] = channelsRaw
      ? JSON.parse(channelsRaw)
      : [];
    const searches: {
      name: string;
      keywords: string;
      searchOrder?: YouTubeSearchOrder;
      enabled?: boolean;
    }[] = searchRaw ? JSON.parse(searchRaw) : [];
    const videos: { name: string; url: string; enabled?: boolean }[] = videosRaw
      ? JSON.parse(videosRaw)
      : [];

    if (channels.length) {
      await supabase.from("youtube_channels").insert(
        channels.map((c, i) => ({
          organization_id: orgId,
          name: c.name,
          url: c.url,
          enabled: c.enabled ?? true,
          rank: i,
        })),
      );
    }
    if (searches.length) {
      await supabase.from("youtube_search_channels").insert(
        searches.map((s, i) => ({
          organization_id: orgId,
          name: s.name,
          keywords: s.keywords,
          search_order: s.searchOrder ?? DEFAULT_SEARCH_ORDER,
          enabled: s.enabled ?? true,
          rank: i,
        })),
      );
    }
    if (videos.length) {
      await supabase.from("youtube_video_links").insert(
        videos.map((v, i) => ({
          organization_id: orgId,
          name: v.name,
          url: v.url,
          enabled: v.enabled ?? true,
          rank: i,
        })),
      );
    }
  } catch (err) {
    console.warn("YouTube localStorage migration failed", err);
    // Clear the flag so the migration is retried on the next load.
    localStorage.removeItem(flagKey);
    return;
  }

  // Clear local copies now that data is safely in Supabase.
  localStorage.removeItem(CHANNELS_KEY);
  localStorage.removeItem(SEARCH_CHANNELS_KEY);
  localStorage.removeItem(VIDEO_LINKS_KEY);
}

// ---------------------------------------------------------------------------
// Channels
// ---------------------------------------------------------------------------

export async function getYouTubeChannels(orgId: string): Promise<YouTubeChannel[]> {
  await migrateLegacyDataIfNeeded(orgId);
  const { data, error } = await supabase
    .from("youtube_channels")
    .select("id, name, url, enabled, rank")
    .eq("organization_id", orgId)
    .order("rank", { ascending: true })
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({ id: r.id, name: r.name, url: r.url, enabled: r.enabled }));
}

export async function addYouTubeChannel(
  orgId: string,
  name: string,
  url: string,
): Promise<YouTubeChannel | null> {
  const { data, error } = await supabase
    .from("youtube_channels")
    .insert({ organization_id: orgId, name, url, enabled: true })
    .select("id, name, url, enabled")
    .single();
  if (error || !data) return null;
  return { id: data.id, name: data.name, url: data.url, enabled: data.enabled };
}

export async function removeYouTubeChannel(orgId: string, id: string): Promise<void> {
  await supabase.from("youtube_channels").delete().eq("organization_id", orgId).eq("id", id);
}

export async function toggleYouTubeChannel(orgId: string, id: string): Promise<void> {
  const { data } = await supabase
    .from("youtube_channels")
    .select("enabled")
    .eq("organization_id", orgId)
    .eq("id", id)
    .single();
  if (!data) return;
  await supabase
    .from("youtube_channels")
    .update({ enabled: !data.enabled })
    .eq("organization_id", orgId)
    .eq("id", id);
}

export async function renameYouTubeChannel(orgId: string, id: string, name: string): Promise<void> {
  await supabase
    .from("youtube_channels")
    .update({ name })
    .eq("organization_id", orgId)
    .eq("id", id);
}

export async function getEnabledYouTubeChannels(orgId: string): Promise<YouTubeChannel[]> {
  return (await getYouTubeChannels(orgId)).filter((c) => c.enabled);
}

// ---------------------------------------------------------------------------
// Video links
// ---------------------------------------------------------------------------

export async function getYouTubeVideoLinks(orgId: string): Promise<YouTubeVideoLink[]> {
  await migrateLegacyDataIfNeeded(orgId);
  const { data, error } = await supabase
    .from("youtube_video_links")
    .select("id, name, url, enabled, rank")
    .eq("organization_id", orgId)
    .order("rank", { ascending: true })
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({ id: r.id, name: r.name, url: r.url, enabled: r.enabled }));
}

export async function addYouTubeVideoLink(
  orgId: string,
  name: string,
  url: string,
): Promise<YouTubeVideoLink | null> {
  const { data, error } = await supabase
    .from("youtube_video_links")
    .insert({ organization_id: orgId, name, url, enabled: true })
    .select("id, name, url, enabled")
    .single();
  if (error || !data) return null;
  return { id: data.id, name: data.name, url: data.url, enabled: data.enabled };
}

export async function removeYouTubeVideoLink(orgId: string, id: string): Promise<void> {
  await supabase.from("youtube_video_links").delete().eq("organization_id", orgId).eq("id", id);
}

export async function toggleYouTubeVideoLink(orgId: string, id: string): Promise<void> {
  const { data } = await supabase
    .from("youtube_video_links")
    .select("enabled")
    .eq("organization_id", orgId)
    .eq("id", id)
    .single();
  if (!data) return;
  await supabase
    .from("youtube_video_links")
    .update({ enabled: !data.enabled })
    .eq("organization_id", orgId)
    .eq("id", id);
}

export async function renameYouTubeVideoLink(orgId: string, id: string, name: string): Promise<void> {
  await supabase
    .from("youtube_video_links")
    .update({ name })
    .eq("organization_id", orgId)
    .eq("id", id);
}

export async function getEnabledYouTubeVideoLinks(orgId: string): Promise<YouTubeVideoLink[]> {
  return (await getYouTubeVideoLinks(orgId)).filter((l) => l.enabled);
}

export function getVideoLinkUrl(link: YouTubeVideoLink): string {
  return /^https?:\/\//i.test(link.url) ? link.url : `https://${link.url}`;
}

export function getChannelVideoUrl(channel: YouTubeChannel): string {
  const url = /^https?:\/\//i.test(channel.url) ? channel.url : `https://${channel.url}`;
  if (/\/watch\?/i.test(url) || /youtu\.be\//i.test(url)) return url;
  const base = url
    .replace(/\/(videos|streams|playlists|community|about|featured).*$/, "")
    .replace(/\/+$/, "");
  return `${base}/videos`;
}

// ---------------------------------------------------------------------------
// Search channels
// ---------------------------------------------------------------------------

export async function getYouTubeSearchChannels(orgId: string): Promise<YouTubeSearchChannel[]> {
  await migrateLegacyDataIfNeeded(orgId);
  const { data, error } = await supabase
    .from("youtube_search_channels")
    .select("id, name, keywords, search_order, enabled, rank")
    .eq("organization_id", orgId)
    .order("rank", { ascending: true })
    .order("name", { ascending: true });
  if (error || !data) return [];
  return data.map((r) => ({
    id: r.id,
    name: r.name,
    keywords: r.keywords,
    searchOrder: (r.search_order as YouTubeSearchOrder) ?? DEFAULT_SEARCH_ORDER,
    enabled: r.enabled,
  }));
}

export async function addYouTubeSearchChannel(
  orgId: string,
  name: string,
  keywords: string,
  searchOrder: YouTubeSearchOrder = DEFAULT_SEARCH_ORDER,
): Promise<YouTubeSearchChannel | null> {
  const { data, error } = await supabase
    .from("youtube_search_channels")
    .insert({
      organization_id: orgId,
      name,
      keywords,
      search_order: searchOrder,
      enabled: true,
    })
    .select("id, name, keywords, search_order, enabled")
    .single();
  if (error || !data) return null;
  return {
    id: data.id,
    name: data.name,
    keywords: data.keywords,
    searchOrder: data.search_order as YouTubeSearchOrder,
    enabled: data.enabled,
  };
}

export async function removeYouTubeSearchChannel(orgId: string, id: string): Promise<void> {
  await supabase.from("youtube_search_channels").delete().eq("organization_id", orgId).eq("id", id);
}

export async function toggleYouTubeSearchChannel(orgId: string, id: string): Promise<void> {
  const { data } = await supabase
    .from("youtube_search_channels")
    .select("enabled")
    .eq("organization_id", orgId)
    .eq("id", id)
    .single();
  if (!data) return;
  await supabase
    .from("youtube_search_channels")
    .update({ enabled: !data.enabled })
    .eq("organization_id", orgId)
    .eq("id", id);
}

export async function setYouTubeSearchChannelOrder(
  orgId: string,
  id: string,
  searchOrder: YouTubeSearchOrder,
): Promise<void> {
  await supabase
    .from("youtube_search_channels")
    .update({ search_order: searchOrder })
    .eq("organization_id", orgId)
    .eq("id", id);
}

export async function renameYouTubeSearchChannel(orgId: string, id: string, name: string): Promise<void> {
  await supabase
    .from("youtube_search_channels")
    .update({ name })
    .eq("organization_id", orgId)
    .eq("id", id);
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

// ---------------------------------------------------------------------------
// YouTube Data API proxy (uses YOUTUBE_API_KEY server-side)
// ---------------------------------------------------------------------------

export interface YouTubeApiVideo {
  videoId: string;
  title: string;
  channelTitle: string;
  publishedAt: string;
  thumbnail: string;
}

/**
 * Calls the `youtube-proxy` edge function which uses the server-side
 * YOUTUBE_API_KEY to query the YouTube Data API.
 *
 * action: 'search' (params: q, order, maxResults)
 * action: 'channelVideos' (params: channelHandleOrId, maxResults)
 */
export async function callYouTubeApi<T = unknown>(
  action: "search" | "channelVideos",
  params: Record<string, string | number | undefined>,
): Promise<T | null> {
  const { data, error } = await supabase.functions.invoke("youtube-proxy", {
    body: { action, params },
  });
  if (error) {
    console.error("youtube-proxy call failed", error);
    return null;
  }
  return data as T;
}
