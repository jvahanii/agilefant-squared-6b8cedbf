// Shared helpers for the Gmail App User Connector integration.
//
// Each app user connects their own Gmail account through Lovable's connector
// gateway.  The gateway returns a per-user connection key (lovack_…) which we
// store encrypted at rest in `gmail_connections`; provider calls are made
// server-side only, never from the browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeUrl } from './urls.ts';
import { extractLinks, header, type ExtractedLink, type GmailMessage, type LinkMode } from './extract.ts';

// Re-exported so existing importers of this module keep working.
export { normalizeUrl, extractLinks, header };
export type { ExtractedLink, GmailMessage, LinkMode };

export const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

export const GATEWAY = 'https://connector-gateway.lovable.dev';
export const CONNECTOR_ID = 'google_mail';
export const GMAIL_BASE = `${GATEWAY}/${CONNECTOR_ID}/gmail/v1`;

export const GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/userinfo.email',
  'https://www.googleapis.com/auth/userinfo.profile',
  'https://www.googleapis.com/auth/gmail.readonly',
];

export function env(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`${name} is not configured`);
  return v;
}

export function adminClient() {
  return createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));
}

export function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

/** Throws with a `[status]: body` message so the top-level catch can relay it. */
async function relay(res: Response, label: string): Promise<never> {
  const text = await res.text();
  console.error(`${label} failed [${res.status}]: ${text}`);
  throw new Error(`[${res.status}] ${label}: ${text}`);
}

// ─── connection key encryption ────────────────────────────────────────────

async function aesKey(): Promise<CryptoKey> {
  const raw = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(env('APP_USER_CONNECTION_KEY_SECRET')),
  );
  return crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

function b64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function unb64(text: string): Uint8Array {
  return Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
}

export async function encryptKey(plain: string): Promise<string> {
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const cipher = new Uint8Array(
    await crypto.subtle.encrypt({ name: 'AES-GCM', iv }, await aesKey(), new TextEncoder().encode(plain)),
  );
  return `${b64(iv)}.${b64(cipher)}`;
}

export async function decryptKey(stored: string): Promise<string> {
  const [ivPart, cipherPart] = stored.split('.');
  if (!ivPart || !cipherPart) throw new Error('stored connection key is malformed');
  const plain = await crypto.subtle.decrypt(
    { name: 'AES-GCM', iv: unb64(ivPart) },
    await aesKey(),
    unb64(cipherPart),
  );
  return new TextDecoder().decode(plain);
}

// ─── OAuth (per app user) ─────────────────────────────────────────────────

export async function startAuthorize(appUserId: string, returnUrl: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/api/v1/app-users/oauth2/authorize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('LOVABLE_API_KEY')}`,
      'X-Client-Api-Key': env('GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      connector_id: CONNECTOR_ID,
      app_user_id: appUserId,
      return_url: returnUrl,
      credentials_configuration: { scopes: GOOGLE_SCOPES },
    }),
  });
  if (!res.ok) await relay(res, 'gateway authorize');
  const data = await res.json();
  return data.authorization_url as string;
}

export async function exchangeCode(code: string): Promise<string> {
  const res = await fetch(`${GATEWAY}/api/v1/app-users/oauth2/exchange`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('LOVABLE_API_KEY')}`,
      'X-Client-Api-Key': env('GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY'),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ code }),
  });
  if (!res.ok) await relay(res, 'gateway exchange');
  const data = await res.json();
  const key = data.connection_api_key ?? data.connection_key ?? data.api_key ?? data.key;
  if (typeof key !== 'string' || key.length === 0) {
    console.error('unexpected exchange response shape', Object.keys(data ?? {}));
    throw new Error('gateway exchange returned no connection key');
  }
  return key;
}

// ─── Gmail API ────────────────────────────────────────────────────────────

export async function gmail<T>(connectionKey: string, path: string): Promise<T> {
  const res = await fetch(`${GMAIL_BASE}${path}`, {
    headers: {
      Authorization: `Bearer ${env('LOVABLE_API_KEY')}`,
      'X-Connection-Api-Key': connectionKey,
    },
  });
  if (!res.ok) await relay(res, `gmail ${path}`);
  return await res.json() as T;
}

export async function getConnection(
  admin: ReturnType<typeof adminClient>,
  userId: string,
): Promise<{ key: string; email: string | null }> {
  const { data, error } = await admin
    .from('gmail_connections')
    .select('connection_key_encrypted, connected_email')
    .eq('user_id', userId)
    .maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('gmail_not_connected');
  return { key: await decryptKey(data.connection_key_encrypted as string), email: data.connected_email as string | null };
}

// ─── message parsing / link extraction ────────────────────────────────────

/** Fetch matching messages for a query and return all extracted links. */
export async function searchLinks(
  connectionKey: string,
  query: string,
  maxMessages: number,
): Promise<ExtractedLink[]> {
  const ids: string[] = [];
  let pageToken: string | undefined;
  while (ids.length < maxMessages) {
    const params = new URLSearchParams({
      q: query,
      maxResults: String(Math.min(100, maxMessages - ids.length)),
    });
    if (pageToken) params.set('pageToken', pageToken);
    const page = await gmail<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
      connectionKey,
      `/users/me/messages?${params.toString()}`,
    );
    for (const m of page.messages ?? []) ids.push(m.id);
    if (!page.nextPageToken) break;
    pageToken = page.nextPageToken;
  }

  const links: ExtractedLink[] = [];
  const CONCURRENCY = 5;
  for (let i = 0; i < ids.length; i += CONCURRENCY) {
    const batch = ids.slice(i, i + CONCURRENCY);
    const messages = await Promise.all(
      batch.map((id) => gmail<GmailMessage>(connectionKey, `/users/me/messages/${id}?format=full`)),
    );
    for (const msg of messages) links.push(...extractLinks(msg, mode));
  }
  return links;
}
