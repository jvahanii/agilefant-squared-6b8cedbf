/**
 * A Gmail connection that has expired should say "connect Gmail again", not
 * show the raw 401. The shared connector's body is quoted from the real failure:
 * a connection made on 10 September stopped on the 17th, seven days on, as a
 * Google OAuth app in "Testing" does.
 */
import { describe, it, expect } from 'vitest';
import { needsReconnect } from '../../supabase/functions/_shared/gmailAuthErrors';

const EXPIRED = '{"status":401,"message":"user must re-authorize: refresh token expired","details":""}';

describe('needsReconnect', () => {
  it('reads an expired shared-connector connection as one to reconnect', () => {
    expect(needsReconnect('gateway', 401, EXPIRED)).toBe(true);
    expect(needsReconnect('gateway', 401, '{"error":"invalid_grant"}')).toBe(true);
  });

  it('does not blame the connection for a 401 that is about Agilefant\u2019s own key', () => {
    expect(needsReconnect('gateway', 401, '{"message":"invalid API key"}')).toBe(false);
  });

  it('treats any 401 from Google itself as a withdrawn connection', () => {
    expect(needsReconnect('google', 401, '')).toBe(true);
  });

  it('ignores other statuses', () => {
    expect(needsReconnect('gateway', 403, EXPIRED)).toBe(false);
    expect(needsReconnect('google', 500, '')).toBe(false);
  });
});
