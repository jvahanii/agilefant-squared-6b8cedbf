import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

/**
 * Whether this organization rates its work items. Off by default: no stars on
 * a row, and "Rating ★ best first" is not among the sort modes. Ratings
 * already set are kept, so switching it off hides them rather than losing them.
 */
export function useRatingsEnabled(): boolean {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  return useOrgSettingsStore((s) => s.settings[activeOrgId ?? ""]?.ratingsEnabled ?? false);
}
