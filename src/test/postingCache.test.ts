/**
 * The rule deciding when the closed-ad check may answer from memory instead of
 * asking a job board again. It exists because the boards refuse: LinkedIn
 * answers 999 to a datacentre address running a sweep, and the only sound
 * response is to need far fewer requests, not to disguise them.
 */
import { describe, it, expect } from 'vitest';
import {
  OPEN_TTL_MS,
  hashTarget,
  usable,
  type Verdict,
} from '../../supabase/functions/_shared/postingCache';

const NOW = Date.UTC(2026, 8, 16, 12, 0, 0);
const verdict = (closed: boolean, ageMs: number): Verdict => ({
  closed,
  deadline: null,
  checkedAt: NOW - ageMs,
});

describe('usable', () => {
  it('never re-asks about a posting that has closed', () => {
    // Applications do not reopen, so this answer keeps for good — which is what
    // makes the second sweep over a backlog cheap.
    expect(usable(verdict(true, 0), NOW)).toBe(true);
    expect(usable(verdict(true, OPEN_TTL_MS * 365), NOW)).toBe(true);
  });

  it('believes a still-open posting for a day', () => {
    expect(usable(verdict(false, 0), NOW)).toBe(true);
    expect(usable(verdict(false, OPEN_TTL_MS - 1000), NOW)).toBe(true);
  });

  it('asks again once an open posting has gone stale', () => {
    // An open ad can close any day, so yesterday's answer is not evidence.
    expect(usable(verdict(false, OPEN_TTL_MS + 1000), NOW)).toBe(false);
  });
});

describe('hashTarget', () => {
  it('is stable, and is the length a key column expects', async () => {
    const target = 'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4458065583';
    const first = await hashTarget(target);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
    expect(await hashTarget(target)).toBe(first);
  });

  it('separates different postings', async () => {
    expect(await hashTarget('https://a.example/1')).not.toBe(await hashTarget('https://a.example/2'));
  });

  it('keeps a very long URL down to a key a btree will take', async () => {
    // The reason for hashing at all: job links carry hundreds of characters of
    // tracking parameters, and an index refuses a key past about 2.7 KB.
    const long = `https://a.example/job?${'trk=x&'.repeat(600)}`;
    expect(long.length).toBeGreaterThan(2704);
    expect(await hashTarget(long)).toHaveLength(64);
  });
});
