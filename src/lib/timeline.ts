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
  /** The day the work is due. Given only where deadlines are shown: an
   *  organization that keeps none has none on its calendar either. */
  deadline?: string;
}

/**
 * The days the timeline spans: from a week before the earliest date to a week
 * after the latest — a deadline is a date like the others — always taking in
 * today so "now" is on the chart. With no
 * dated item at all it is the month around today, so there is somewhere to
 * point at when the first date is set.
 */
export function timelineRange(items: Dated[], today: number): TimelineRange {
  let min = today;
  let max = today;
  let any = false;
  for (const item of items) {
    for (const day of [dayNumber(item.startedOn), dayNumber(item.endedOn), dayNumber(item.deadline)]) {
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

/**
 * The widths a day can be zoomed to, narrowest first. They include the four
 * dayWidth chooses from, so zooming starts from wherever the automatic scale
 * left off rather than jumping to a scale of its own.
 */
export const ZOOM_WIDTHS = [2, 4, 6, 10, 16, 24, 40, 64] as const;

/** The next width in or out from this one, or null at the end of the scale. */
export function zoomStep(width: number, direction: 1 | -1): number | null {
  if (direction > 0) return ZOOM_WIDTHS.find((w) => w > width) ?? null;
  return [...ZOOM_WIDTHS].reverse().find((w) => w < width) ?? null;
}

/**
 * A zoom the reader chose: one of the widths, or "fit" — the whole span on the
 * screen at once, whatever width that takes.
 */
export type ZoomChoice = number | "fit";

/** A stored zoom, if it is one that can be chosen; otherwise none chosen. */
export function validZoom(value: unknown): ZoomChoice | null {
  if (value === "fit") return "fit";
  const n = Number(value);
  return (ZOOM_WIDTHS as readonly number[]).includes(n) ? n : null;
}

/** The narrowest a day is drawn, however long the span being fitted. */
export const MIN_FIT_WIDTH = 0.05;

/**
 * The width a day gets for the whole span to fit in so many pixels, so that
 * every bar is on the screen at once. No wider than the widest zoom — a few
 * days are not stretched across a whole screen — and null where there is no
 * room to measure, when the caller falls back on the automatic scale.
 */
export function fitWidth(range: TimelineRange, available: number): number | null {
  if (!(available > 0)) return null;
  const days = range.end - range.start + 1;
  return Math.min(ZOOM_WIDTHS[ZOOM_WIDTHS.length - 1], Math.max(MIN_FIT_WIDTH, available / days));
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

/**
 * How an item stands against its deadline:
 *   ahead   it is still to come, and the work has not ended
 *   met     the work ended on or before it
 *   missed  the work ended after it — or has not ended, and it has gone by
 */
export type DeadlineState = "ahead" | "met" | "missed";

export interface DeadlineMark {
  /** The day the work is due. */
  day: number;
  state: DeadlineState;
  /**
   * The days between the work and its deadline, first and last included:
   *   left  from where unfinished work has got to, up to the deadline — the
   *         time there still is
   *   over  from the day after the deadline to where the work ended, or to
   *         today if it has not — how late it is
   * Null when there is neither: work that ended in time, or work with no bar
   * whose deadline is still ahead.
   */
  stretch: { kind: "left" | "over"; from: number; to: number } | null;
}

/**
 * An item's deadline on the calendar, or null when it has none. The day it
 * falls on, whether it was kept, and the stretch between it and the work —
 * so that "due the 12th" can be read against the bar, not only beside it.
 */
export function deadlineMark(item: Dated, today: number): DeadlineMark | null {
  const day = dayNumber(item.deadline);
  if (day === null) return null;
  const end = dayNumber(item.endedOn);
  const bar = barFor(item, today);
  const state: DeadlineState = end !== null ? (end <= day ? "met" : "missed") : day < today ? "missed" : "ahead";
  // Where the work has got to: the end of its bar, or today for work that is
  // late without ever having been given a start.
  const reached = bar ? bar.to : state === "missed" ? today : null;
  if (reached !== null && reached > day) return { day, state, stretch: { kind: "over", from: day + 1, to: reached } };
  if (bar && end === null && bar.to < day) return { day, state, stretch: { kind: "left", from: bar.to + 1, to: day } };
  return { day, state, stretch: null };
}

/** The same in words, for a tooltip and for screen readers. */
export function describeDeadline(item: Dated, mark: DeadlineMark): string {
  const base = `Deadline ${item.deadline}`;
  if (mark.state === "ahead") return base;
  if (mark.state === "met") return `${base} — met`;
  const end = dayNumber(item.endedOn);
  if (end === null) return `${base} — passed`;
  const late = end - mark.day;
  return `${base} — ended ${late} day${late === 1 ? "" : "s"} late`;
}

/** What is being dragged: the whole bar, or one of its ends. */
export type DragMode = "move" | "start" | "end";

/**
 * The dates a drag of so many days leaves an item with — only the ones that
 * change, as yyyy-mm-dd; nothing when the drag changes nothing.
 *
 * Moving shifts whichever dates the item has, keeping its length. Dragging an
 * end moves that end alone, and stops at the other: a bar can be shrunk to a
 * single day, not turned inside out. Work still going has no end to drag, so
 * its open end — drawn at today — is what is taken hold of, and letting go of
 * it gives the work an end date.
 */
export function dragDates(item: Dated, mode: DragMode, days: number, today: number): Dated {
  const start = dayNumber(item.startedOn);
  const end = dayNumber(item.endedOn);
  if (days === 0) return {};
  if (mode === "move") {
    return {
      ...(start !== null ? { startedOn: dayIso(start + days) } : {}),
      ...(end !== null ? { endedOn: dayIso(end + days) } : {}),
    };
  }
  if (mode === "start") {
    if (start === null) return {};
    const next = end !== null ? Math.min(start + days, end) : start + days;
    return next === start ? {} : { startedOn: dayIso(next) };
  }
  const held = end ?? (start !== null ? Math.max(today, start) : null);
  if (held === null) return {};
  const next = start !== null ? Math.max(held + days, start) : held + days;
  return end !== null && next === end ? {} : { endedOn: dayIso(next) };
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

/**
 * The days the bars of these items cover between them — from the first day of
 * the earliest to the last day of the latest, and so everything in between —
 * with their deadlines, which are as much to be seen as the bars. Null when
 * none of them has either.
 */
export function spanOf(items: Dated[], today: number): { from: number; to: number } | null {
  let span: { from: number; to: number } | null = null;
  for (const item of items) {
    const bar = barFor(item, today);
    const days = [bar?.from, bar?.to, dayNumber(item.deadline)].filter((d): d is number => typeof d === "number");
    if (days.length === 0) continue;
    const from = Math.min(...days);
    const to = Math.max(...days);
    span = span ? { from: Math.min(span.from, from), to: Math.max(span.to, to) } : { from, to };
  }
  return span;
}

/**
 * The width to zoom out to for so many days to fit the room there is — or null
 * when they fit at the current width, and nothing need change. The widest step
 * that fits, so the scale stays one the zoom buttons know; narrower than every
 * step only for a span no step can hold.
 */
export function widthToShow(days: number, available: number, current: number): number | null {
  if (!(available > 0) || days * current <= available) return null;
  const step = [...ZOOM_WIDTHS].reverse().find((w) => w < current && days * w <= available);
  return step ?? Math.max(MIN_FIT_WIDTH, available / days);
}

/** The width at which each day can be read; a selection is never zoomed in past it. */
const COMFORTABLE_WIDTH = 24;
/** How much of the view a selection is zoomed in to fill, the rest left as surroundings. */
const CLOSE_IN_SHARE = 0.7;

/**
 * The width to zoom in to for so many days to be worth looking at — or null
 * when the current width already serves. A selection drawn as a sliver is
 * brought up to the widest step at which it still leaves its surroundings in
 * view, and no wider than days can be read at.
 *
 * Only when that at least doubles the scale: stepping through rows of much
 * the same length must not nudge the zoom in and out at every one.
 */
export function widthToCloseIn(days: number, available: number, current: number): number | null {
  if (!(available > 0)) return null;
  const step = [...ZOOM_WIDTHS]
    .reverse()
    .find((w) => w <= COMFORTABLE_WIDTH && days * w <= available * CLOSE_IN_SHARE);
  return step !== undefined && step >= current * 2 ? step : null;
}

/** Where to scroll the calendar so a span of days sits in the middle of the view. */
export function scrollToCentre(
  span: { from: number; to: number },
  range: TimelineRange,
  width: number,
  available: number,
): number {
  const middle = ((span.from + span.to + 1) / 2 - range.start) * width;
  return Math.max(0, middle - available / 2);
}

/**
 * Where to scroll the calendar so a span of days is in view, or null when it
 * already is. Moved no further than it takes: a span off to the left comes in
 * at the left edge, one off to the right at the right, each with a little air.
 */
export function scrollToShow(
  span: { from: number; to: number },
  range: TimelineRange,
  width: number,
  scrollLeft: number,
  available: number,
  air = 16,
): number | null {
  const left = (span.from - range.start) * width;
  const right = (span.to + 1 - range.start) * width;
  if (left >= scrollLeft && right <= scrollLeft + available) return null;
  // Wider than the view even now: show where it starts.
  if (right - left > available || left < scrollLeft) return Math.max(0, left - air);
  return Math.max(0, right - available + air);
}

/**
 * The years the range covers, each with the part of it that is shown — for the
 * axis once the scale is too small for a month to carry its name.
 */
export function yearTicks(range: TimelineRange): MonthTick[] {
  const ticks: MonthTick[] = [];
  let day = range.start;
  while (day <= range.end) {
    const year = new Date(day * DAY_MS).getUTCFullYear();
    const nextYear = Math.round(Date.UTC(year + 1, 0, 1) / DAY_MS);
    const last = Math.min(nextYear - 1, range.end);
    ticks.push({ from: day, days: last - day + 1, label: String(year) });
    day = last + 1;
  }
  return ticks;
}

/** The room a year written in full takes on the axis — "2026" — and written short — "'26". */
export const YEAR_LABEL_PX = 34;
export const SHORT_YEAR_LABEL_PX = 21;

/**
 * How a year is named on the axis, given how wide a year is drawn — or null
 * for a year that goes unnamed.
 *
 * A name is only written where it fits. Written wider than its column it ran
 * under the next year's, and a row of years read "199 199 200 200". So as the
 * columns narrow the year is first written short, and then only every fifth
 * year is named, and every tenth, each with the columns after it to run into.
 * `columnPx` is the room the year's own column has — the first and the last
 * of a span are seldom whole — and `yearPx` what a whole year takes.
 */
export function yearLabel(year: number, columnPx: number, yearPx: number): string | null {
  const every = yearPx >= SHORT_YEAR_LABEL_PX ? 1 : yearPx * 5 >= YEAR_LABEL_PX ? 5 : 10;
  if (year % every !== 0) return null;
  const room = columnPx + (every - 1) * yearPx;
  if (room >= YEAR_LABEL_PX) return String(year);
  if (room >= SHORT_YEAR_LABEL_PX) return `'${String(year % 100).padStart(2, "0")}`;
  return null;
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
