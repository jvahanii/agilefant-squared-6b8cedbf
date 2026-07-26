import { useAppStore } from "@/store/appStore";
import { useOrgStore } from "@/store/orgStore";
import { useOrgSettingsStore } from "@/store/orgSettingsStore";

/**
 * Effective points visibility combines the organization-level toggle with an
 * optional per-tree override. A tree defaults to inheriting the org setting.
 * A tree with `pointsEnabled === false` hides points even when the org has
 * points enabled.
 */
export function computePointsVisible(
  orgPointsEnabled: boolean,
  treePointsEnabled: boolean | null | undefined,
): boolean {
  if (!orgPointsEnabled) return false;
  return treePointsEnabled !== false;
}

/** Hook that returns effective points visibility for a specific tree. */
export function usePointsVisibleForTree(treeId: string | null | undefined): boolean {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const orgPointsEnabled = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""]?.pointsEnabled ?? false,
  );
  const treePointsEnabled = useAppStore((s) =>
    treeId ? s.backlogTrees[treeId]?.pointsEnabled ?? null : null,
  );
  return computePointsVisible(orgPointsEnabled, treePointsEnabled);
}

/**
 * Hook for entities that live across multiple trees (e.g. a work item in the
 * mobile attributes sheet). Points are visible if the org enables them and at
 * least one assigned tree hasn't opted out.
 */
export function usePointsVisibleForTrees(treeIds: string[]): boolean {
  const activeOrgId = useOrgStore((s) => s.activeOrgId);
  const orgPointsEnabled = useOrgSettingsStore(
    (s) => s.settings[activeOrgId ?? ""]?.pointsEnabled ?? false,
  );
  const anyTreeEnabled = useAppStore((s) => {
    if (treeIds.length === 0) return true;
    return treeIds.some((tid) => s.backlogTrees[tid]?.pointsEnabled !== false);
  });
  return orgPointsEnabled && anyTreeEnabled;
}
