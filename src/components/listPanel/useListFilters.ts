/**
 * The label and team chips under the filter box: which are chosen, the items
 * they match (any chosen label, or any chosen team), and those items listed
 * from every tree. The tree in view shows the matches with the items above
 * them, opened so they can be seen.
 */
import { useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useTeamStore } from "@/store/teamStore";
import { placesOf, type ItemPlace } from "./itemPlaces";

/** Add the id if it is not there, take it out if it is. */
const toggled = (set: Set<string>, id: string) => {
  const next = new Set(set);
  if (next.has(id)) next.delete(id);
  else next.add(id);
  return next;
};

export function useListFilters(selectedBacklogId: string | null) {
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const byEntity = useLabelsStore((s) => s.byEntity);
  const workItemTeams = useTeamStore((s) => s.workItemTeams);
  const [labelIds, setLabelIds] = useState<Set<string>>(new Set());
  const [teamIds, setTeamIds] = useState<Set<string>>(new Set());

  // Another list starts unfiltered.
  useEffect(() => {
    setLabelIds(new Set());
    setTeamIds(new Set());
  }, [selectedBacklogId]);

  // The items that match the chosen labels and teams: any of either. Null when
  // nothing is chosen.
  const matching = useMemo<Set<string> | null>(() => {
    if (labelIds.size === 0 && teamIds.size === 0) return null;
    const found = new Set<string>();
    if (labelIds.size > 0) {
      for (const [key, ids] of Object.entries(byEntity)) {
        if (!key.startsWith("work_item:")) continue;
        if (ids.some((id) => labelIds.has(id))) found.add(key.slice("work_item:".length));
      }
    }
    if (teamIds.size > 0) {
      for (const [workItemId, ids] of Object.entries(workItemTeams)) {
        if (ids.some((tid) => teamIds.has(tid))) found.add(workItemId);
      }
    }
    return found;
  }, [labelIds, teamIds, byEntity, workItemTeams]);

  // The matches and the items above them, so their path stays in the tree.
  const visible = useMemo<Set<string> | null>(() => {
    if (!matching) return null;
    const shown = new Set(matching);
    for (const itemId of matching) {
      let curr = workItems[itemId];
      while (curr?.parentId) {
        shown.add(curr.parentId);
        curr = workItems[curr.parentId];
      }
    }
    return shown;
  }, [matching, workItems]);

  // Open the items above each match when the filter changes.
  useEffect(() => {
    if (!visible) return;
    const state = useAppStore.getState();
    for (const id of visible) {
      const item = state.workItems[id];
      const hasVisibleChild = item?.childrenIds.some((cid) => visible.has(cid));
      if (hasVisibleChild && !state.expandedWorkItems.has(id)) state.toggleWorkItemExpand(id);
    }
  }, [visible]);

  /** The matches from every tree, by name. Null when nothing is chosen. */
  const results = useMemo<ItemPlace[] | null>(() => {
    if (!matching) return null;
    return Array.from(matching)
      .flatMap((itemId) => {
        const wi = workItems[itemId];
        return wi ? placesOf(wi, workItems, backlogs, backlogTrees) : [];
      })
      .sort((a, b) => a.item.title.localeCompare(b.item.title) || a.treeName.localeCompare(b.treeName));
  }, [matching, workItems, backlogTrees, backlogs]);

  const byLabel = labelIds.size > 0;
  const byTeam = teamIds.size > 0;
  return {
    labelIds,
    teamIds,
    toggleLabel: (id: string) => setLabelIds((prev) => toggled(prev, id)),
    toggleTeam: (id: string) => setTeamIds((prev) => toggled(prev, id)),
    clearLabels: () => setLabelIds(new Set()),
    clearTeams: () => setTeamIds(new Set()),
    clear: () => {
      setLabelIds(new Set());
      setTeamIds(new Set());
    },
    /** Some label or team is chosen: the results replace the tree. */
    active: byLabel || byTeam,
    title: byLabel && byTeam ? "Filter results" : byTeam ? "Team filter results" : "Label filter results",
    /** The tree's rows to show while filtering: matches and the items above them. */
    visible,
    results,
  };
}

export type ListFilters = ReturnType<typeof useListFilters>;
