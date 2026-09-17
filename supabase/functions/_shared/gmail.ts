// Shared helpers for the Gmail App User Connector integration.
//
// Each app user connects their own Gmail account through Lovable's connector
// gateway.  The gateway returns a per-user connection key (lovack_…) which we
// store encrypted at rest in `gmail_connections`; provider calls are made
// server-side only, never from the browser.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { normalizeUrl } from './urls.ts';
import { extractLinks, header, type ExtractedLink, type GmailMessage, type LinkMode } from './extract.ts';
import { GMAIL_API_BASE, accessTokenSource, type OAuthClient } from './googleOAuth.ts';
import { needsReconnect } from './gmailAuthErrors.ts';

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

/**
 * Start a consent through the shared connector.
 *
 * `existingKey` is the user's stored connection key, when they have connected
 * before. The gateway refuses a reconnect without it — "Reconnect requires the
 * X-Connection-Api-Key header with this user's stored lovack_* connection key"
 * — so an expired connection could not be renewed at all. Omitted only on a
 * first connect.
 */
export async function startAuthorize(appUserId: string, returnUrl: string, existingKey?: string | null): Promise<string> {
  const res = await fetch(`${GATEWAY}/api/v1/app-users/oauth2/authorize`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${env('LOVABLE_API_KEY')}`,
      'X-Client-Api-Key': env('GOOGLE_MAIL_APP_USER_CONNECTOR_CLIENT_API_KEY'),
      ...(existingKey ? { 'X-Connection-Api-Key': existingKey } : {}),
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

/**
 * How a call reaches Gmail.
 *
 * `gateway` goes through the shared connector with a connection key, as every
 * call once did. `google` goes to Gmail directly with an access token from the
 * organization's own OAuth client. Which one applies is decided per
 * organization by gmailScope, never by the caller.
 */
export type GmailAuth =
  | { kind: 'gateway'; key: string }
  | { kind: 'google'; token: () => Promise<string> };

export async function gmail<T>(auth: GmailAuth, path: string): Promise<T> {
  const res =
    auth.kind === 'gateway'
      ? await fetch(`${GMAIL_BASE}${path}`, {
          headers: {
            Authorization: `Bearer ${env('LOVABLE_API_KEY')}`,
            'X-Connection-Api-Key': auth.key,
          },
        })
      : await fetch(`${GMAIL_API_BASE}${path}`, {
          headers: { Authorization: `Bearer ${await auth.token()}` },
        });
  // Once access has been withdrawn or has expired the person needs to connect
  // again, and saying so is more useful than relaying the raw body.
  if (res.status === 401) {
    const body = await res.text();
    if (needsReconnect(auth.kind, res.status, body)) {
      console.error(`gmail ${path}: connection needs re-authorizing: ${body}`);
      throw new Error('gmail_not_connected');
    }
    console.error(`gmail ${path} failed [401]: ${body}`);
    throw new Error(`[401] gmail ${path}: ${body}`);
  }
  if (!res.ok) await relay(res, `gmail ${path}`);
  return await res.json() as T;
}

// ─── Which connector an organization uses ─────────────────────────────────

type Admin = ReturnType<typeof adminClient>;

/**
 * Whether an organization connects Gmail through the shared connector, or must
 * use its own Google OAuth client.
 *
 * Read from a table only the service role can reach, so no organization can
 * put itself on the shared connector.
 */
export async function usesSharedConnector(admin: Admin, organizationId: string): Promise<boolean> {
  const { data, error } = await admin
    .from('gmail_shared_connector_organizations')
    .select('organization_id')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

/** The organization's own Google OAuth client, secret decrypted, if it has one. */
export async function getOAuthClient(
  admin: Admin,
  organizationId: string,
): Promise<(OAuthClient & { updatedAt: string }) | null> {
  const { data, error } = await admin
    .from('organization_google_oauth_clients')
    .select('client_id, client_secret_encrypted, updated_at')
    .eq('organization_id', organizationId)
    .maybeSingle();
  if (error) throw error;
  if (!data) return null;
  return {
    clientId: data.client_id as string,
    clientSecret: await decryptKey(data.client_secret_encrypted as string),
    updatedAt: data.updated_at as string,
  };
}

/**
 * Narrow a gmail_connections query to the connection that serves this
 * organization: the user's shared one, or the one made with its own client.
 */
//
// Typed loosely on purpose, like the Admin type in gmailImport.ts: supabase-js's
// builder types recurse deeply enough that a generic over them exceeds what the
// compiler will instantiate.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function forScope(query: any, shared: boolean, organizationId: string): any {
  return shared ? query.is('organization_id', null) : query.eq('organization_id', organizationId);
}

export async function getConnection(
  admin: Admin,
  userId: string,
  organizationId: string,
): Promise<{ auth: GmailAuth; email: string | null }> {
  const shared = await usesSharedConnector(admin, organizationId);
  const { data, error } = await forScope(
    admin.from('gmail_connections').select('connection_key_encrypted, connected_email').eq('user_id', userId),
    shared,
    organizationId,
  ).maybeSingle();
  if (error) throw error;
  if (!data) throw new Error('gmail_not_connected');

  const secret = await decryptKey(data.connection_key_encrypted as string);
  const email = data.connected_email as string | null;
  if (shared) return { auth: { kind: 'gateway', key: secret }, email };

  const client = await getOAuthClient(admin, organizationId);
  if (!client) throw new Error('oauth_client_not_configured');
  return { auth: { kind: 'google', token: accessTokenSource(fetch, client, secret) }, email };
}

// ─── message parsing / link extraction ────────────────────────────────────

/** Fetch matching messages for a query and return all extracted links. */
export async function searchLinks(
  auth: GmailAuth,
  query: string,
  maxMessages: number,
  mode: LinkMode = 'links',
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
      auth,
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
      batch.map((id) => gmail<GmailMessage>(auth, `/users/me/messages/${id}?format=full`)),
    );
    for (const msg of messages) links.push(...extractLinks(msg, mode));
  }
  return links;
}
