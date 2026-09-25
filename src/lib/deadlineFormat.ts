import type { WorkItem } from "@/types/models";

/*
 * How a deadline reads and compares, with no store in sight: the public page
 * uses these too, and is kept free of the app's stores to stay small.
 */

/** A yyyy-mm-dd as a local calendar date, or null for anything else. */
function asDate(iso: string): Date | null {
  const m = iso.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * A deadline as a row shows it: day and month in the reader's own format
 * ("30.9." in Finland), with the year only when it is not this one.
 */
export function formatDeadline(iso: string, now: Date = new Date(), locale?: string): string {
  const d = asDate(iso);
  if (!d) return iso;
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(locale, sameYear ? { day: "numeric", month: "numeric" } : undefined);
}

/**
 * Has the deadline gone by, on the reader's own calendar? The day itself still
 * counts as open.
 *
 * Local, not UTC: in Finland a deadline of the 24th has passed at one in the
 * morning on the 25th, while UTC still calls it the 24th until three. The job-ad
 * closed check compares in UTC (it shares the importer's rule, which runs on a
 * server), so the two can disagree for those few hours around midnight — the
 * row, which a person reads, follows their calendar.
 */
export function isDeadlinePassed(iso: string | undefined, now: Date | number = Date.now()): boolean {
  if (!iso || !asDate(iso)) return false;
  const today = new Date(now);
  const pad = (n: number) => String(n).padStart(2, "0");
  const todayIso = `${today.getFullYear()}-${pad(today.getMonth() + 1)}-${pad(today.getDate())}`;
  return iso < todayIso;
}

/** Soonest first; items without a deadline after every item with one. */
export function compareDeadlines(a: Pick<WorkItem, "deadline">, b: Pick<WorkItem, "deadline">): number {
  if (a.deadline && b.deadline) return a.deadline < b.deadline ? -1 : a.deadline > b.deadline ? 1 : 0;
  if (a.deadline) return -1;
  if (b.deadline) return 1;
  return 0;
}

/** Only a real calendar date as yyyy-mm-dd, for anything typed or pasted. */
export function wellFormedDeadline(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const d = asDate(value);
  if (!d) return undefined;
  // new Date(2026, 1, 31) rolls over to 3 March; that is not the date typed.
  const [y, m, day] = value.split("-").map(Number);
  return d.getFullYear() === y && d.getMonth() === m - 1 && d.getDate() === day ? value : undefined;
}

/**
 * A deadline as someone types it, as yyyy-mm-dd — or undefined when it is not
 * a real date yet. The field shows and asks for YYYY-MM-DD, the same in every
 * country; the browser's own date input would show the reader's locale
 * (12/31/2027) and cannot be told otherwise. Quick forms are taken too:
 * "2026-9-30" and "20260930" both mean 2026-09-30.
 */
export function parseDeadlineInput(text: string): string | undefined {
  const t = text.trim();
  const m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})$/) ?? t.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (!m) return undefined;
  return wellFormedDeadline(`${m[1]}-${m[2].padStart(2, "0")}-${m[3].padStart(2, "0")}`);
}

/** A local calendar date as yyyy-mm-dd, for what a date picker hands back. */
export function toIsoDate(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** A yyyy-mm-dd as a local calendar date, for handing to a date picker. */
export function fromIsoDate(iso: string): Date | undefined {
  return asDate(iso) ?? undefined;
}
