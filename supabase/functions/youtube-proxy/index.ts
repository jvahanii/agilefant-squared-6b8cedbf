// YouTube Data API v3 proxy
// Uses the server-side YOUTUBE_API_KEY secret. Requires an authenticated caller.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.95.0';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers':
    'authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version',
};

interface RequestBody {
  action?: 'search' | 'channelVideos';
  params?: Record<string, string | number | undefined>;
}

const YT_BASE = 'https://www.googleapis.com/youtube/v3';

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

function clampMax(v: unknown, fallback = 10): number {
  const n = typeof v === 'number' ? v : Number(v);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return Math.min(50, Math.max(1, Math.floor(n)));
}

function mapVideos(items: any[]): unknown[] {
  return (items ?? []).map((it) => ({
    videoId: it.id?.videoId ?? it.contentDetails?.videoId ?? it.id,
    title: it.snippet?.title ?? '',
    channelTitle: it.snippet?.channelTitle ?? '',
    publishedAt: it.snippet?.publishedAt ?? '',
    thumbnail:
      it.snippet?.thumbnails?.medium?.url ??
      it.snippet?.thumbnails?.default?.url ??
      '',
  }));
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // Auth
  const authHeader = req.headers.get('Authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    return json({ error: 'Unauthorized' }, 401);
  }
  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  );
  const token = authHeader.replace('Bearer ', '');
  const { data: claims, error: authErr } = await supabase.auth.getClaims(token);
  if (authErr || !claims?.claims) {
    return json({ error: 'Unauthorized' }, 401);
  }

  const apiKey = Deno.env.get('YOUTUBE_API_KEY');
  if (!apiKey) return json({ error: 'YOUTUBE_API_KEY is not configured' }, 500);

  let body: RequestBody;
  try {
    body = await req.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, 400);
  }

  const action = body.action;
  const params = body.params ?? {};

  try {
    if (action === 'search') {
      const q = String(params.q ?? '').trim();
      if (!q) return json({ error: 'q (query) is required' }, 400);
      const order = ['relevance', 'date', 'viewCount', 'rating', 'title'].includes(
        String(params.order ?? ''),
      )
        ? String(params.order)
        : 'relevance';
      const maxResults = clampMax(params.maxResults, 10);

      const url = new URL(`${YT_BASE}/search`);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('type', 'video');
      url.searchParams.set('q', q);
      url.searchParams.set('order', order);
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('key', apiKey);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) {
        return json({ error: 'YouTube API error', details: data }, res.status);
      }
      return json({ items: mapVideos(data.items) });
    }

    if (action === 'channelVideos') {
      const handleOrId = String(params.channelHandleOrId ?? '').trim();
      if (!handleOrId) {
        return json({ error: 'channelHandleOrId is required' }, 400);
      }
      const maxResults = clampMax(params.maxResults, 10);

      // Resolve to channelId
      let channelId = handleOrId;
      if (!/^UC[A-Za-z0-9_-]{20,}$/.test(handleOrId)) {
        const lookup = new URL(`${YT_BASE}/channels`);
        lookup.searchParams.set('part', 'id');
        if (handleOrId.startsWith('@')) {
          lookup.searchParams.set('forHandle', handleOrId);
        } else {
          lookup.searchParams.set('forUsername', handleOrId.replace(/^@/, ''));
        }
        lookup.searchParams.set('key', apiKey);
        const lookupRes = await fetch(lookup.toString());
        const lookupData = await lookupRes.json();
        if (!lookupRes.ok || !lookupData.items?.length) {
          return json(
            { error: 'Could not resolve channel', details: lookupData },
            lookupRes.ok ? 404 : lookupRes.status,
          );
        }
        channelId = lookupData.items[0].id;
      }

      const url = new URL(`${YT_BASE}/search`);
      url.searchParams.set('part', 'snippet');
      url.searchParams.set('type', 'video');
      url.searchParams.set('channelId', channelId);
      url.searchParams.set('order', 'date');
      url.searchParams.set('maxResults', String(maxResults));
      url.searchParams.set('key', apiKey);

      const res = await fetch(url.toString());
      const data = await res.json();
      if (!res.ok) {
        return json({ error: 'YouTube API error', details: data }, res.status);
      }
      return json({ channelId, items: mapVideos(data.items) });
    }

    return json({ error: `Unknown action: ${String(action)}` }, 400);
  } catch (err) {
    console.error('youtube-proxy error', err);
    const msg = err instanceof Error ? err.message : 'Unknown error';
    return json({ error: msg }, 500);
  }
});
