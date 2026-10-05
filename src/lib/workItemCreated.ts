import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { formatDeadline } from "@/lib/deadlineFormat";

/**
 * Whether this organization shows created dates. Off by default: no date on a
 * row, no "Created date…" in the menu, and no created sort. The dates are kept
 * either way — every new item gets one — so switching it on later shows them.
 */
export function useCreatedDatesEnabled(): boolean {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  return useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.createdDatesEnabled ?? false);
}

/**
 * A created date as a row shows it: day and month in the reader's own format,
 * with the year only when it is not this one — the same reading as a deadline,
 * so the two dates on a row never look like different kinds of thing.
 */
export function formatCreatedOn(iso: string, now: Date = new Date(), locale?: string): string {
  return formatDeadline(iso, now, locale);
}
