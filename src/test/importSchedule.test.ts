/**
 * Which saved Gmail queries run at a given waking of the hourly checker.
 *
 * The rule has to hold across a daylight saving change and across midnight in a
 * zone that is not the server's, neither of which anyone would notice going
 * wrong until a run happened an hour late or twice in a night.
 */
import { describe, it, expect } from 'vitest';
import { isDue, type ScheduledQuery } from '../../supabase/functions/_shared/importSchedule';

const daily = (over: Partial<ScheduledQuery> = {}): ScheduledQuery => ({
  frequency: 'daily',
  lastRunAt: null,
  runAtHour: null,
  runAtTimezone: null,
  ...over,
});

/** The checker wakes at seven minutes past the hour; these are those wakings. */
const waking = (iso: string) => new Date(iso);

describe('isDue, with no hour chosen', () => {
  it('runs a query that has never run', () => {
    expect(isDue(daily(), waking('2026-09-16T19:07:00Z'))).toBe(true);
  });

  it('waits until a day has almost passed, then runs', () => {
    const lastRunAt = '2026-09-15T19:07:08Z';
    // 22h59m52s later: the waking an hour before the anniversary.
    expect(isDue(daily({ lastRunAt }), waking('2026-09-16T18:07:00Z'))).toBe(false);
    expect(isDue(daily({ lastRunAt }), waking('2026-09-16T19:07:00Z'))).toBe(true);
  });

  it('holds an hourly query to the hour', () => {
    const lastRunAt = '2026-09-16T18:07:00Z';
    expect(isDue({ ...daily({ lastRunAt }), frequency: 'hourly' }, waking('2026-09-16T18:40:00Z'))).toBe(false);
    expect(isDue({ ...daily({ lastRunAt }), frequency: 'hourly' }, waking('2026-09-16T19:07:00Z'))).toBe(true);
  });
});

describe('isDue, with an hour chosen', () => {
  const at8 = (over: Partial<ScheduledQuery> = {}) =>
    daily({ runAtHour: 8, runAtTimezone: 'Europe/Helsinki', ...over });

  it('runs only in the chosen hour, read where the owner is', () => {
    // Helsinki is UTC+3 in September, so 08:07 there is 05:07 UTC.
    expect(isDue(at8(), waking('2026-09-16T05:07:00Z'))).toBe(true);
    expect(isDue(at8(), waking('2026-09-16T06:07:00Z'))).toBe(false);
    expect(isDue(at8(), waking('2026-09-16T19:07:00Z'))).toBe(false);
  });

  it('runs once a day, not at every waking of that hour', () => {
    const lastRunAt = '2026-09-16T05:07:10Z';
    expect(isDue(at8({ lastRunAt }), waking('2026-09-16T05:37:00Z'))).toBe(false);
    // The same hour tomorrow is a different day where the owner lives.
    expect(isDue(at8({ lastRunAt }), waking('2026-09-17T05:07:00Z'))).toBe(true);
  });

  it('keeps the chosen hour across a daylight saving change', () => {
    // Helsinki leaves summer time on 25 October 2026: 08:00 local is 05:00 UTC
    // before and 06:00 UTC after. Folding the hour into UTC when it was chosen
    // would have run this an hour early all winter.
    expect(isDue(at8(), waking('2026-10-24T05:07:00Z'))).toBe(true);
    expect(isDue(at8(), waking('2026-10-26T06:07:00Z'))).toBe(true);
    expect(isDue(at8(), waking('2026-10-26T05:07:00Z'))).toBe(false);
  });

  it('counts the day where the owner is, not in UTC', () => {
    // 01:07 in Helsinki is the previous day in UTC. A run made then must still
    // block a second run later that same local day.
    const query = daily({ runAtHour: 1, runAtTimezone: 'Europe/Helsinki', lastRunAt: '2026-09-15T22:07:05Z' });
    expect(isDue(query, waking('2026-09-15T22:37:00Z'))).toBe(false);
    expect(isDue(query, waking('2026-09-16T22:07:00Z'))).toBe(true);
  });

  it('falls back on the plain gap when the zone means nothing', () => {
    // Rather than running at an hour nobody asked for.
    const broken = daily({ runAtHour: 8, runAtTimezone: 'Mars/Olympus_Mons', lastRunAt: '2026-09-15T19:07:08Z' });
    expect(isDue(broken, waking('2026-09-16T18:07:00Z'))).toBe(false);
    expect(isDue(broken, waking('2026-09-16T19:07:00Z'))).toBe(true);
  });

  it('ignores an hour with no zone to read it in', () => {
    const noZone = daily({ runAtHour: 8, runAtTimezone: null, lastRunAt: '2026-09-15T19:07:08Z' });
    expect(isDue(noZone, waking('2026-09-16T19:07:00Z'))).toBe(true);
  });
});
