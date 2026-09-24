/**
 * The opening state of the logged-time report: which period it starts on and
 * how it groups. Kept apart from the dialog so both can be tested without
 * rendering it, and so the dialog file exports only its component.
 */

export type GroupDimension = "tree" | "backlog" | "item" | "user" | "date";

export type PeriodPreset = "today" | "week" | "month" | "all";

/** The From and To dates a period button sets, as YYYY-MM-DD in local time. */
export function presetRange(preset: PeriodPreset, today: Date = new Date()): { from: string; to: string } {
  const pad = (n: number) => String(n).padStart(2, "0");
  const fmt = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  if (preset === "today") {
    const t = fmt(today);
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
 * How the summary groups until someone chooses otherwise: by person and then
 * by work item wherever more than one person has logged time, and by work item
 * alone where only one has — a solo organization does not need its own name
 * above every row.
 */
export function defaultGroupDims(people: number): GroupDimension[] {
  return people > 1 ? ["user", "item"] : ["item"];
}
