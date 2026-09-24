/**
 * The opening state of the logged-time report: which period it starts on and
 * how it groups. Kept apart from the dialog so both can be tested without
 * rendering it, and so the dialog file exports only its component.
 */

export type GroupDimension = "tree" | "backlog" | "item" | "user" | "date";

export type PeriodPreset = "today" | "yesterday" | "week" | "month" | "all";

/** The From and To dates a period button sets, as YYYY-MM-DD in local time. */
export function presetRange(preset: PeriodPreset, today: Date = new Date()): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (preset === "today") {
    const t = fmt(today);
    return { from: t, to: t };
  }
  if (preset === "yesterday") {
    const y = new Date(today);
    y.setDate(today.getDate() - 1);
    const t = fmt(y);
    return { from: t, to: t };
  }
  if (preset === "week") {
    const dow = today.getDay(); // 0=Sun
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((dow + 6) % 7));
    const sunday = new Date(monday);
    sunday.setDate(monday.getDate() + 6);
    return { from: fmt(monday), to: fmt(sunday) };
  }
  if (preset === "month") {
    const first = new Date(today.getFullYear(), today.getMonth(), 1);
    const last = new Date(today.getFullYear(), today.getMonth() + 1, 0);
    return { from: fmt(first), to: fmt(last) };
  }
  return { from: "", to: "" };
}

/**
 * How the summary groups until someone chooses otherwise: the whole path from a
 * person down to the work item, so any total can be followed to what made it —
 * the person first, even where there is only one, since it is the same
 * question asked of a team.
 */
export const DEFAULT_GROUP_DIMS: readonly GroupDimension[] = ["user", "tree", "backlog", "item"];

/** The presets the period buttons offer, in the order they are shown. */
export const PERIOD_PRESETS: readonly PeriodPreset[] = ["today", "yesterday", "week", "month", "all"];

/**
 * Which preset the current From and To dates are, or null for any other range.
 * Derived from the dates rather than remembered from the last button pressed,
 * so a range typed by hand that happens to be this week lights "This week",
 * and one that is no preset lights none.
 */
export function activePreset(from: string, to: string, today: Date = new Date()): PeriodPreset | null {
  for (const preset of PERIOD_PRESETS) {
    const range = presetRange(preset, today);
    if (range.from === from && range.to === to) return preset;
  }
  return null;
}
