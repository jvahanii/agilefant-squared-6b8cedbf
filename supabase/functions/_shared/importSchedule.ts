// When a saved Gmail import query is due.
//
// pg_cron wakes the checker at seven minutes past every hour. This decides,
// on each of those wakings, which queries should actually run -- kept apart from
// the function that runs them so the rule can be tested without Deno, a
// database, or waiting a day.

export interface ScheduledQuery {
  frequency: string;
  /** ISO timestamp of the last scheduled run, or null if it has never run. */
  lastRunAt: string | null;
  /** Hour of day the owner asked for, 0-23, or null for no preference. */
  runAtHour: number | null;
  /** IANA zone the hour is expressed in. */
  runAtTimezone: string | null;
}

/** An hourly query runs every waking; the gap only guards against a double tick. */
const HOURLY_GAP_MS = 55 * 60 * 1000;
/**
 * Not 24, deliberately. At exactly 24 hours the waking that ought to run a
 * query would fall a fraction short and be skipped, and the query would walk an
 * hour later every day. An hour of slack keeps it where it is.
 */
const DAILY_GAP_MS = 23 * 60 * 60 * 1000;

/** The hour and the calendar day as they read in `timezone`. */
function localParts(at: Date, timezone: string): { hour: number; day: string } | null {
  try {
    const hour = Number(
      new Intl.DateTimeFormat('en-GB', { timeZone: timezone, hour: '2-digit', hour12: false }).format(at),
    );
    // en-CA renders as YYYY-MM-DD, which is all this needs it to be.
    const day = new Intl.DateTimeFormat('en-CA', { timeZone: timezone }).format(at);
    return Number.isNaN(hour) ? null : { hour, day };
  } catch {
    // An unknown zone: the caller falls back on the plain gap rule rather than
    // running at a time nobody asked for.
    return null;
  }
}

/**
 * Should this query run at this waking?
 *
 * With an hour chosen, a daily query runs on the first waking of that hour, once
 * per day in its own timezone. Without one, the old rule stands: run when the
 * gap since the last run is long enough.
 */
export function isDue(q: ScheduledQuery, now: Date = new Date()): boolean {
  const last = q.lastRunAt ? new Date(q.lastRunAt).getTime() : 0;
  const since = now.getTime() - (Number.isNaN(last) ? 0 : last);

  if (q.frequency === 'hourly') return since >= HOURLY_GAP_MS;

  if (q.runAtHour !== null && q.runAtTimezone) {
    const here = localParts(now, q.runAtTimezone);
    if (here) {
      if (here.hour !== q.runAtHour) return false;
      if (!q.lastRunAt) return true;
      // Once a day: a run already made today, where the query lives, is enough.
      // This is what stops a second waking inside the same hour running it
      // twice, and it needs no clock arithmetic to do it.
      const then = localParts(new Date(q.lastRunAt), q.runAtTimezone);
      return !then || then.day !== here.day;
    }
  }

  return since >= DAILY_GAP_MS;
}
