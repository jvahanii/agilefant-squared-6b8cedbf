import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

export { compareDeadlines, formatDeadline, isDeadlinePassed, wellFormedDeadline } from "@/lib/deadlineFormat";

/**
 * Whether this organization uses deadlines. Off by default: no date on a row,
 * no "Deadline…" in the menu, and no deadline sort. Deadlines already set are
 * kept, so switching it off hides them rather than losing them.
 */
export function useDeadlinesEnabled(): boolean {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  return useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.deadlinesEnabled ?? false);
}
