import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";
import { formatDeadline } from "@/lib/deadlineFormat";

/**
 * Whether this organization uses start and end dates. Off by default: nothing
 * in the menus, nothing on the rows. Dates already set are kept, so switching
 * it off hides them rather than losing them. Each list then decides for itself
 * whether its rows show them; setting them needs only this.
 */
export function useStartEndDatesEnabled(): boolean {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  return useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.startEndDatesEnabled ?? false);
}

/**
 * The two dates as a row shows them, as one span: "1.10.–5.10.", "1.10.–" for
 * work that has started and not ended, "–5.10." for an end with no recorded
 * start. Each date reads as a deadline does. Empty when neither is set.
 */
export function formatStartEnd(
  startedOn: string | undefined,
  endedOn: string | undefined,
  now: Date = new Date(),
  locale?: string,
): string {
  if (!startedOn && !endedOn) return "";
  const show = (iso: string | undefined) => (iso ? formatDeadline(iso, now, locale) : "");
  return `${show(startedOn)}–${show(endedOn)}`;
}

/** The same in words, for a tooltip and for screen readers. */
export function describeStartEnd(startedOn: string | undefined, endedOn: string | undefined): string {
  if (startedOn && endedOn) return `Started ${startedOn}, ended ${endedOn}`;
  if (startedOn) return `Started ${startedOn}, not ended`;
  if (endedOn) return `Ended ${endedOn}`;
  return "";
}

/** An end before its start is not a span of work; equal days are fine. */
export function endsBeforeItStarts(startedOn: string | undefined, endedOn: string | undefined): boolean {
  return !!startedOn && !!endedOn && endedOn < startedOn;
}
