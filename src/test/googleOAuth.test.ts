/**
 * Connecting Gmail through an organization's own Google OAuth client.
 *
 * Nothing here reaches Google: fetch is replaced. What is being checked is the
 * part that is ours to get wrong — a state that cannot be forged or replayed
 * across users, a consent URL that yields a refresh token, and token errors
 * turned into messages a person can act on.
 */
import { describe, it, expect, vi } from 'vitest';
import {
  STATE_TTL_MS,
  accessTokenSource,
  exchangeGoogleCode,
  googleAuthorizeUrl,
  looksLikeGoogleClientId,
  refreshGoogleToken,
  signState,
  verifyState,
} from '../../supabase/functions/_shared/googleOAuth';

const SECRET = 'test-secret';
const FIELDS = { userId: 'user-1', organizationId: 'org-1', redirectUri: 'https://agilefant.org/gmail-callback.html' };
const CLIENT = { clientId: '123-abc.apps.googleusercontent.com', clientSecret: 'shh' };

const jsonResponse = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

describe('signState / verifyState', () => {
  it('round-trips for the user and organization that started it', async () => {
    const state = await signState(SECRET, FIELDS);
    const payload = await verifyState(SECRET, state, { userId: 'user-1', organizationId: 'org-1' });
    expect(payload.r).toBe(FIELDS.redirectUri);
  });

  it('refuses a state finished by a different user', async () => {
    // The attack this exists for: someone starts a consent with their own
    // Google account and gets another person's session to complete it.
    const state = await signState(SECRET, FIELDS);
    await expect(verifyState(SECRET, state, { userId: 'user-2', organizationId: 'org-1' })).rejects.toThrow(
      'oauth_state_invalid',
    );
  });

  it('refuses a state carried over to another organization', async () => {
    const state = await signState(SECRET, FIELDS);
    await expect(verifyState(SECRET, state, { userId: 'user-1', organizationId: 'org-2' })).rejects.toThrow(
      'oauth_state_invalid',
    );
  });

  it('refuses a state whose contents were altered', async () => {
    const state = await signState(SECRET, FIELDS);
    const [, signature] = state.split('.');
    const forged = btoa(JSON.stringify({ u: 'user-2', o: 'org-1', r: 'x', e: Date.now() + 60_000, n: 'n' }))
      .replace(/=+$/, '');
    await expect(verifyState(SECRET, `${forged}.${signature}`, { userId: 'user-2', organizationId: 'org-1' })).rejects.toThrow(
      'oauth_state_invalid',
    );
  });

  it('refuses a state signed with another secret', async () => {
    const state = await signState('other-secret', FIELDS);
    await expect(verifyState(SECRET, state, { userId: 'user-1', organizationId: 'org-1' })).rejects.toThrow(
      'oauth_state_invalid',
    );
  });

  it('refuses a state after it has expired', async () => {
    const start = Date.UTC(2026, 8, 16, 12);
    const state = await signState(SECRET, FIELDS, start);
    await expect(
      verifyState(SECRET, state, { userId: 'user-1', organizationId: 'org-1' }, start + STATE_TTL_MS + 1),
    ).rejects.toThrow('oauth_state_expired');
  });

  it('refuses garbage', async () => {
    for (const bad of ['', 'nodot', 'a.b', '....']) {
      await expect(verifyState(SECRET, bad, { userId: 'user-1', organizationId: 'org-1' })).rejects.toThrow();
    }
  });
});

describe('googleAuthorizeUrl', () => {
  it('asks for a refresh token every time', () => {
    const url = new URL(
      googleAuthorizeUrl({ clientId: CLIENT.clientId, redirectUri: FIELDS.redirectUri, state: 's', scopes: ['a', 'b'] }),
    );
    expect(url.origin + url.pathname).toBe('https://accounts.google.com/o/oauth2/v2/auth');
    expect(url.searchParams.get('access_type')).toBe('offline');
    // Without prompt=consent, reconnecting yields no refresh token and the
    // connection dies with its first access token.
    expect(url.searchParams.get('prompt')).toBe('consent');
    expect(url.searchParams.get('scope')).toBe('a b');
    expect(url.searchParams.get('redirect_uri')).toBe(FIELDS.redirectUri);
    expect(url.searchParams.get('state')).toBe('s');
  });
});

describe('exchangeGoogleCode', () => {
  it('returns the refresh token it will store', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      jsonResponse(200, { access_token: 'at', refresh_token: 'rt', expires_in: 3599 }),
    );
    const result = await exchangeGoogleCode(fetchImpl, CLIENT, 'code', FIELDS.redirectUri);
    expect(result.refreshToken).toBe('rt');
    const body = new URLSearchParams(fetchImpl.mock.calls[0][1].body as string);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('redirect_uri')).toBe(FIELDS.redirectUri);
    expect(body.get('client_secret')).toBe('shh');
  });

  it('refuses a consent that came back without a refresh token', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: 'at', expires_in: 3599 }));
    await expect(exchangeGoogleCode(fetchImpl, CLIENT, 'code', FIELDS.redirectUri)).rejects.toThrow(/refresh token/);
  });

  it('names a wrong client ID or secret as such', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(401, { error: 'invalid_client' }));
    await expect(exchangeGoogleCode(fetchImpl, CLIENT, 'code', FIELDS.redirectUri)).rejects.toThrow(
      'oauth_client_rejected',
    );
  });
});

describe('refreshGoogleToken', () => {
  it('turns an expired or revoked grant into "connect again"', async () => {
    // Includes a Testing-mode app's refresh token lapsing after seven days.
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(400, { error: 'invalid_grant' }));
    await expect(refreshGoogleToken(fetchImpl, CLIENT, 'rt')).rejects.toThrow('gmail_not_connected');
  });
});

describe('accessTokenSource', () => {
  it('refreshes once for a whole search, not once per message', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, { access_token: 'at', expires_in: 3599 }));
    const token = accessTokenSource(fetchImpl, CLIENT, 'rt');

    const tokens = await Promise.all(Array.from({ length: 12 }, () => token()));

    expect(new Set(tokens)).toEqual(new Set(['at']));
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('looksLikeGoogleClientId', () => {
  it('accepts the shape Google issues and catches a secret in the wrong field', () => {
    expect(looksLikeGoogleClientId('1234567890-abcdef123.apps.googleusercontent.com')).toBe(true);
    expect(looksLikeGoogleClientId('GOCSPX-thisIsASecretNotAnId')).toBe(false);
    expect(looksLikeGoogleClientId('')).toBe(false);
  });
});
