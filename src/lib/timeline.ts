/**
 * The geometry of the timeline view: which days it spans, how wide a day is,
 * where each item's bar sits and what the axis is labelled with. No React and
 * no stores, so the arithmetic that decides what is drawn where can be tested
 * on its own.
 *
 * Days are counted as whole days since 1970 in UTC. A yyyy-mm-dd has no time
 * or zone, so counting it in UTC keeps every day exactly one unit wide — in
 * local time the days around a clock change are 23 or 25 hours long, and bars
 * crossing one would come out a sliver short or long.
 */

const DAY_MS = 86_400_000;

/** A yyyy-mm-dd as a day number, or null for anything else. */
export function dayNumber(iso: string | null | undefined): number | null {
  const m = iso?.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const ms = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(ms) ? null : Math.round(ms / DAY_MS);
}

/** A day number back as yyyy-mm-dd. */
export function dayIso(day: number): string {
  return new Date(day * DAY_MS).toISOString().slice(0, 10);
}

/** Today on the reader's own calendar, as a day number. */
export function todayNumber(now: Date = new Date()): number {
  return Math.round(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / DAY_MS);
}

export interface TimelineRange {
  /** First and last day drawn, both included. */
  start: number;
  end: number;
}

export interface Dated {
  startedOn?: string;
  endedOn?: string;
}

/**
 * The days the timeline spans: from a week before the earliest date to a week
 * after the latest, always taking in today so "now" is on the chart. With no
 * dated item at all it is the month around today, so there is somewhere to
 * point at when the first date is set.
 */
export function timelineRange(items: Dated[], today: number): TimelineRange {
  let min = today;
  let max = today;
  let any = false;
  for (const item of items) {
    for (const day of [dayNumber(item.startedOn), dayNumber(item.endedOn)]) {
      if (day === null) continue;
      any = true;
      if (day < min) min = day;
      if (day > max) max = day;
    }
  }
  const pad = any ? 7 : 15;
  return { start: min - pad, end: max + pad };
}

/**
 * How many pixels a day gets. A few weeks are drawn wide enough to read each
 * day; years are squeezed so the whole span still fits a few screens.
 */
export function dayWidth(range: TimelineRange): number {
  const days = range.end - range.start + 1;
  if (days <= 62) return 24;
  if (days <= 185) return 10;
  if (days <= 740) return 4;
  return 2;
}

export type BarKind =
  /** Started and ended: a closed bar. */
  | "span"
  /** Started, not ended, and the start is not in the future: runs to today, open-ended. */
  | "ongoing"
  /** Started in the future with no end: a one-day marker of where it begins. */
  | "planned"
  /** An end with no recorded start: a marker on the day it ended. */
  | "end-only";

export interface TimelineBar {
  kind: BarKind;
  /** First and last day covered, both included. */
  from: number;
  to: number;
}

/**
 * Where an item's bar goes, or null when it has neither date. An end before
 * its start cannot be set from the app, but data can arrive otherwise; it is
 * drawn as the span between the two rather than not at all.
 */
export function barFor(item: Dated, today: number): TimelineBar | null {
  const start = dayNumber(item.startedOn);
  const end = dayNumber(item.endedOn);
  if (start === null && end === null) return null;
  if (start !== null && end !== null) return { kind: "span", from: Math.min(start, end), to: Math.max(start, end) };
  if (start !== null) {
    return start <= today ? { kind: "ongoing", from: start, to: today } : { kind: "planned", from: start, to: start };
  }
  return { kind: "end-only", from: end!, to: end! };
}

/** A bar's left edge and width in pixels, within the track. */
export function barPixels(bar: TimelineBar, range: TimelineRange, width: number): { left: number; width: number } {
  return { left: (bar.from - range.start) * width, width: (bar.to - bar.from + 1) * width };
}

export interface MonthTick {
  /** Day number of the first day of the month that is inside the range. */
  from: number;
  /** How many of the month's days are inside the range. */
  days: number;
  /** "Oct 2026" — the year only on January and on the first month shown. */
  label: string;
}

/** The months the range covers, each with the part of it that is shown. */
export function monthTicks(range: TimelineRange, locale?: string): MonthTick[] {
  const ticks: MonthTick[] = [];
  let day = range.start;
  while (day <= range.end) {
    const date = new Date(day * DAY_MS);
    const year = date.getUTCFullYear();
    const month = date.getUTCMonth();
    const nextMonth = Math.round(Date.UTC(year, month + 1, 1) / DAY_MS);
    const last = Math.min(nextMonth - 1, range.end);
    const withYear = ticks.length === 0 || month === 0;
    ticks.push({
      from: day,
      days: last - day + 1,
      label: date.toLocaleDateString(locale, {
        month: "short",
        ...(withYear ? { year: "numeric" } : {}),
        timeZone: "UTC",
      }),
    });
    day = last + 1;
  }
  return ticks;
}

/** The Mondays in the range, for week lines. */
export function weekStarts(range: TimelineRange): number[] {
  const out: number[] = [];
  // Day 0 (1 January 1970) was a Thursday, so Monday is where (day + 3) % 7 is 0.
  for (let day = range.start; day <= range.end; day++) if ((((day + 3) % 7) + 7) % 7 === 0) out.push(day);
  return out;
}

/** Whether a day is a Saturday or Sunday, for shading. */
export function isWeekend(day: number): boolean {
  const weekday = (((day + 3) % 7) + 7) % 7; // 0 = Monday
  return weekday >= 5;
}
