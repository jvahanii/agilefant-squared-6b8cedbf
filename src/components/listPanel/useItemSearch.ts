/**
 * The search typed into the list's filter box: items from every tree, and
 * lists by name, best match first — fifty at a time, with one chosen by the
 * arrow keys. Words and commands ("/due today") are read by lib/itemSearch.
 */
import { useDeferredValue, useEffect, useMemo, useState } from "react";
import { useAppStore } from "@/store/appStore";
import { useJiraIssuesStore } from "@/store/jiraIssuesStore";
import { useLabelsStore } from "@/store/labelsStore";
import { useTeamStore } from "@/store/teamStore";
import { useScrambledItemsStore } from "@/store/scrambledItemsStore";
import { matchItem, matchName, parseQuery, type ItemMatch, type Ranges, type SearchContext } from "@/lib/itemSearch";
import { itemChangedAt } from "@/lib/itemChangedAt";
import { backlogPathNames, placesOf, type ItemPlace } from "./itemPlaces";

/** An item found, in one of its trees. */
export interface ItemResult extends ItemPlace {
  kind: "workitem";
  score: number;
  changedAt: number;
  ranges: Ranges;
  elsewhere: ItemMatch["elsewhere"];
}

/** A list found by its name. */
export interface BacklogResult {
  kind: "backlog";
  treeId: string;
  backlogId: string;
  treeName: string;
  backlogName: string;
  backlogPath: string[];
  score: number;
  ranges: Ranges;
}

export type SearchResult = ItemResult | BacklogResult;

/** Long result lists are shown fifty at a time. */
export const SEARCH_PAGE = 50;

export function useItemSearch() {
  const query = useAppStore((s) => s.searchQuery);
  const workItems = useAppStore((s) => s.workItems);
  const backlogs = useAppStore((s) => s.backlogs);
  const backlogTrees = useAppStore((s) => s.backlogTrees);
  const scrambledItemNames = useScrambledItemsStore((s) => s.byItem);
  // A synced item is also found by its Jira key: "AF-20".
  const jiraByItem = useJiraIssuesStore((s) => s.byItem);
  const labels = useLabelsStore((s) => s.labels);
  const labelsByEntity = useLabelsStore((s) => s.byEntity);
  const teams = useTeamStore((s) => s.teams);
  const workItemTeams = useTeamStore((s) => s.workItemTeams);
  const hyperlinks = useAppStore((s) => s.hyperlinks);

  // Typing stays quick: with thousands of items the results follow a moment behind.
  const deferredQuery = useDeferredValue(query);
  const parsed = useMemo(() => parseQuery(deferredQuery), [deferredQuery]);
  const context = useMemo<SearchContext>(() => {
    const teamNames = new Map(teams.map((team) => [team.id, team.name]));
    return {
      jiraKey: (id) => jiraByItem.get(id)?.key,
      scrambled: scrambledItemNames,
      labelNames: (id) =>
        (labelsByEntity[`work_item:${id}`] ?? []).flatMap((labelId) => {
          const name = labels[labelId]?.name;
          return name ? [name] : [];
        }),
      teamNames: (id) =>
        (workItemTeams[id] ?? []).flatMap((teamId) => {
          const name = teamNames.get(teamId);
          return name ? [name] : [];
        }),
      links: (id) => (hyperlinks[id] ?? []).map((link) => ({ url: link.url, altText: link.altText })),
      changedAt: (item) => itemChangedAt(item),
    };
  }, [jiraByItem, scrambledItemNames, labels, labelsByEntity, teams, workItemTeams, hyperlinks]);

  /** Null while nothing is being searched for. */
  const results = useMemo((): SearchResult[] | null => {
    if (!parsed.active) return null;

    const itemResults: ItemResult[] = [];
    for (const wi of Object.values(workItems)) {
      const match = matchItem(wi, parsed, context);
      if (!match) continue;
      for (const place of placesOf(wi, workItems, backlogs, backlogTrees)) {
        itemResults.push({
          ...place,
          kind: "workitem",
          score: match.score,
          changedAt: match.changedAt,
          ranges: match.ranges,
          elsewhere: match.elsewhere,
        });
      }
    }

    // Commands are about items: a list has no deadline to be due by.
    const backlogResults: BacklogResult[] =
      parsed.commands.length > 0 || parsed.words.length === 0
        ? []
        : Object.values(backlogs).flatMap((bl) => {
            const match = matchName(bl.name, parsed.words);
            if (!match) return [];
            return [{
              kind: "backlog" as const,
              treeId: bl.treeId,
              backlogId: bl.id,
              treeName: backlogTrees[bl.treeId]?.name ?? "",
              backlogName: bl.name,
              backlogPath: backlogPathNames(backlogs, bl.id),
              score: match.score + 15,
              ranges: match.ranges,
            }];
          });

    const changedOf = (r: SearchResult) => (r.kind === "workitem" ? r.changedAt : 0);
    const nameOf = (r: SearchResult) => (r.kind === "workitem" ? r.item.title : r.backlogName);
    return [...itemResults, ...backlogResults]
      .filter((r) => r.treeId)
      // Equal matches: the most recently changed first (lists have no change time).
      .sort((a, b) => b.score - a.score || changedOf(b) - changedOf(a) || nameOf(a).localeCompare(nameOf(b)) || a.treeName.localeCompare(b.treeName));
  }, [parsed, context, workItems, backlogTrees, backlogs]);

  const [shownCount, setShownCount] = useState(SEARCH_PAGE);
  // The result chosen with the arrow keys; -1 for none.
  const [activeIndex, setActiveIndex] = useState(-1);
  useEffect(() => {
    setShownCount(SEARCH_PAGE);
    setActiveIndex(-1);
  }, [deferredQuery]);
  const shown = useMemo(() => results?.slice(0, shownCount) ?? [], [results, shownCount]);

  return {
    /** Searching now — by what is typed, not the deferred query the results follow. */
    active: parseQuery(query).active,
    parsed,
    deferredQuery,
    results,
    shown,
    showMore: () => setShownCount((n) => n + SEARCH_PAGE),
    activeIndex,
    /** Move the arrow-key choice down or up the results shown. */
    moveActive: (by: 1 | -1) => {
      const last = shown.length - 1;
      setActiveIndex((i) => (by > 0 ? Math.min(i + 1, last) : Math.max(i - 1, 0)));
    },
    /** The result Enter opens: the chosen one, or the best. */
    chosen: (): SearchResult | undefined => shown[Math.max(activeIndex, 0)],
  };
}

export type ItemSearch = ReturnType<typeof useItemSearch>;
