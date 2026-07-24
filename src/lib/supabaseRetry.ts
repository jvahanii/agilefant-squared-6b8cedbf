/**
 * Retry helper for transient Supabase infrastructure blips.
 *
 * Retries on:
 *   - PostgREST schema-cache reload (PGRST002)
 *   - 5xx upstream responses (502/503/504)
 *   - Fetch/network errors (no HTTP status)
 *
 * Does NOT retry on auth errors (401/403), RLS denials, or 4xx client errors.
 *
 * Backoff: 500ms, 1s, 2s, 4s (jittered), capped at 5 attempts.
 */

const MAX_ATTEMPTS = 5;
const BASE_DELAY_MS = 500;
const MAX_DELAY_MS = 4000;

function shouldRetry(err: any): boolean {
  if (!err) return false;
  // Supabase-js returns { code, message, status } for PostgREST errors.
  if (err.code === 'PGRST002') return true;
  const status = typeof err.status === 'number' ? err.status
    : typeof err.statusCode === 'number' ? err.statusCode
    : null;
  if (status !== null && (status === 502 || status === 503 || status === 504)) return true;
  // Network-level failures (TypeError: Failed to fetch, AbortError on transient)
  if (err.name === 'TypeError' && typeof err.message === 'string' && /fetch/i.test(err.message)) return true;
  return false;
}

/**
 * Run a Supabase call with retry-with-backoff on transient infra failures.
 *
 * Usage with the query-builder pattern (returns `{ data, error }`):
 *   const { data, error } = await withSupabaseRetry(() =>
 *     supabase.rpc('get_user_memberships', { _user_id: userId })
 *   );
 *
 * The wrapped fn is re-invoked on each attempt so a fresh request is issued.
 * Returns the last `{ data, error }` if retries are exhausted; caller handles
 * the error normally.
 */
export async function withSupabaseRetry<T extends { error: any }>(
  fn: () => PromiseLike<T>,
): Promise<T> {
  let lastResult: T | undefined;
  for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
    try {
      const result = await fn();
      lastResult = result;
      if (!result.error || !shouldRetry(result.error)) return result;
    } catch (thrown) {
      if (!shouldRetry(thrown)) throw thrown;
      lastResult = { error: thrown } as unknown as T;
    }
    if (attempt < MAX_ATTEMPTS - 1) {
      const delay = Math.min(MAX_DELAY_MS, BASE_DELAY_MS * 2 ** attempt);
      const jitter = Math.random() * 0.3 * delay;
      await new Promise((r) => setTimeout(r, delay + jitter));
    }
  }
  return lastResult as T;
}
