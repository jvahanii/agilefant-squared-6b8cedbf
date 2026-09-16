// Talking to Google directly, with an organization's own OAuth client.
//
// Organizations other than those allowed the shared connector must bring their
// own Google OAuth client. That means doing ourselves what the connector gateway
// did for us: building the consent URL, carrying a state that cannot be forged,
// exchanging the code, and keeping an access token fresh from the refresh token.
//
// No Deno globals and no URL imports here, and fetch and the signing secret are
// passed in, so every step can be tested without a network or a deployment.

export const GOOGLE_AUTHORIZE_URL = 'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_URL = 'https://oauth2.googleapis.com/token';
export const GMAIL_API_BASE = 'https://gmail.googleapis.com/gmail/v1';

/** How long a started consent may take before its state stops being accepted. */
export const STATE_TTL_MS = 10 * 60 * 1000;

export interface OAuthClient {
  clientId: string;
  clientSecret: string;
}

/** What a consent started with, so the callback can be checked against it. */
export interface StatePayload {
  /** The user who started it. */
  u: string;
  /** The organization whose client it used. */
  o: string;
  /** The redirect URI the consent was sent with; the exchange must repeat it. */
  r: string;
  /** Expiry, epoch milliseconds. */
  e: number;
  /** Random, so two consents never share a state. */
  n: string;
}

type Fetch = (input: string, init?: RequestInit) => Promise<Response>;

function b64url(bytes: Uint8Array): string {
  let s = '';
  for (const b of bytes) s += String.fromCharCode(b);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function unb64url(text: string): Uint8Array {
  const padded = text.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (text.length % 4)) % 4);
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmac(secret: string, data: string): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(`google-oauth-state:${secret}`),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  return new Uint8Array(await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(data)));
}

/** Comparison that takes the same time however early the two differ. */
function equalBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

/**
 * A state Google hands back untouched, signed so it cannot be made up.
 *
 * It binds the code that comes back to the user and organization that asked
 * for it. Without that, anyone could start a consent with their own Google
 * account and trick someone else's session into finishing it — attaching the
 * attacker's mailbox to the victim's imports.
 */
export async function signState(
  secret: string,
  fields: { userId: string; organizationId: string; redirectUri: string },
  now: number = Date.now(),
): Promise<string> {
  const payload: StatePayload = {
    u: fields.userId,
    o: fields.organizationId,
    r: fields.redirectUri,
    e: now + STATE_TTL_MS,
    n: b64url(crypto.getRandomValues(new Uint8Array(12))),
  };
  const body = b64url(new TextEncoder().encode(JSON.stringify(payload)));
  return `${body}.${b64url(await hmac(secret, body))}`;
}

/**
 * The payload, if the state is genuine, unexpired, and was started by this user
 * for this organization. Throws otherwise, with a reason that is safe to show.
 */
export async function verifyState(
  secret: string,
  state: string,
  expected: { userId: string; organizationId: string },
  now: number = Date.now(),
): Promise<StatePayload> {
  const [body, signature] = (state ?? '').split('.');
  if (!body || !signature) throw new Error('oauth_state_invalid');

  let given: Uint8Array;
  try {
    given = unb64url(signature);
  } catch {
    throw new Error('oauth_state_invalid');
  }
  if (!equalBytes(given, await hmac(secret, body))) throw new Error('oauth_state_invalid');

  let payload: StatePayload;
  try {
    payload = JSON.parse(new TextDecoder().decode(unb64url(body)));
  } catch {
    throw new Error('oauth_state_invalid');
  }
  if (typeof payload.e !== 'number' || now > payload.e) throw new Error('oauth_state_expired');
  if (payload.u !== expected.userId || payload.o !== expected.organizationId) {
    throw new Error('oauth_state_invalid');
  }
  return payload;
}

/** The consent screen URL for an organization's own client. */
export function googleAuthorizeUrl(params: {
  clientId: string;
  redirectUri: string;
  state: string;
  scopes: string[];
}): string {
  const q = new URLSearchParams({
    client_id: params.clientId,
    redirect_uri: params.redirectUri,
    response_type: 'code',
    scope: params.scopes.join(' '),
    // A refresh token, so scheduled imports can run with nobody present.
    access_type: 'offline',
    // Google only hands out a refresh token on the first consent unless asked
    // again. Reconnecting after a refresh token expired would otherwise produce
    // a connection that stops working the moment its first access token does.
    prompt: 'consent',
    include_granted_scopes: 'true',
    state: params.state,
  });
  return `${GOOGLE_AUTHORIZE_URL}?${q.toString()}`;
}

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(fetchImpl: Fetch, form: Record<string, string>): Promise<TokenResponse> {
  const res = await fetchImpl(GOOGLE_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(form).toString(),
  });
  let data: TokenResponse = {};
  try {
    data = (await res.json()) as TokenResponse;
  } catch {
    data = {};
  }
  if (!res.ok || data.error) {
    // invalid_grant: the user revoked access, the client was reset, or — the
    // common one — a Testing-mode app's refresh token expired after seven days.
    // Every one of those is fixed the same way, by connecting again.
    if (data.error === 'invalid_grant') throw new Error('gmail_not_connected');
    // invalid_client: the organization's client ID or secret is wrong.
    if (data.error === 'invalid_client' || data.error === 'unauthorized_client') {
      throw new Error('oauth_client_rejected');
    }
    throw new Error(`google token request failed [${res.status}]: ${data.error_description ?? data.error ?? 'unknown'}`);
  }
  return data;
}

/** Trade the code Google returned for tokens. Requires a refresh token back. */
export async function exchangeGoogleCode(
  fetchImpl: Fetch,
  client: OAuthClient,
  code: string,
  redirectUri: string,
): Promise<{ accessToken: string; refreshToken: string; expiresAt: number }> {
  const data = await tokenRequest(fetchImpl, {
    code,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    redirect_uri: redirectUri,
    grant_type: 'authorization_code',
  });
  if (!data.access_token) throw new Error('google token response had no access token');
  // Without a refresh token the connection would die within the hour and
  // scheduled imports would never work. Refuse it now rather than then.
  if (!data.refresh_token) throw new Error('google did not return a refresh token; connect again');
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000,
  };
}

/** A fresh access token from a stored refresh token. */
export async function refreshGoogleToken(
  fetchImpl: Fetch,
  client: OAuthClient,
  refreshToken: string,
): Promise<{ accessToken: string; expiresAt: number }> {
  const data = await tokenRequest(fetchImpl, {
    refresh_token: refreshToken,
    client_id: client.clientId,
    client_secret: client.clientSecret,
    grant_type: 'refresh_token',
  });
  if (!data.access_token) throw new Error('google token response had no access token');
  return { accessToken: data.access_token, expiresAt: Date.now() + (data.expires_in ?? 3600) * 1000 };
}

/**
 * An access token source that refreshes once and then reuses the result.
 *
 * A single search fetches the message list and then every message, one call
 * each. Refreshing for every one of those would spend a token request per
 * email and invite Google's rate limits for nothing.
 */
export function accessTokenSource(
  fetchImpl: Fetch,
  client: OAuthClient,
  refreshToken: string,
): () => Promise<string> {
  let current: { token: string; expiresAt: number } | null = null;
  let pending: Promise<string> | null = null;
  return async () => {
    // A minute's margin, so a token is never used in its last seconds.
    if (current && Date.now() < current.expiresAt - 60_000) return current.token;
    if (!pending) {
      pending = refreshGoogleToken(fetchImpl, client, refreshToken)
        .then((r) => {
          current = { token: r.accessToken, expiresAt: r.expiresAt };
          return r.accessToken;
        })
        .finally(() => {
          pending = null;
        });
    }
    return pending;
  };
}

/**
 * A plausible Google OAuth client ID. Not proof it works — only Google can say
 * that — but enough to catch a secret pasted into the wrong field.
 */
export function looksLikeGoogleClientId(value: string): boolean {
  return /^[0-9]+-[a-z0-9]+\.apps\.googleusercontent\.com$/i.test(value.trim());
}
