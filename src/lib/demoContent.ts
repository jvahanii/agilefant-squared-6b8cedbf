import type { Backlog, BacklogTree, WorkItem, WorkItemStatus } from "@/types/models";
import { scopeMockDataToOrganization, type MockDataSnapshot } from "@/store/sync/writes";
import { toIsoDate } from "@/lib/deadlineFormat";
import type { TryItem } from "@/lib/tryList";

/**
 * The example organisation the try-out at /try opens with (2026-11-16): one
 * person's lists and a team's, so a visitor sees nesting, a deadline, done
 * items and a board without making anything first. Nothing here is saved.
 */
export const DEMO_ORG = "00000000-0000-4000-8000-0000000000de";

type Spec = { title: string; status?: WorkItemStatus; due?: number; children?: Spec[] };

const TREES: Array<{ id: string; name: string; lists: Array<{ id: string; name: string; board?: boolean; items: Spec[] }> }> = [
  {
    id: "bt-personal",
    name: "Personal",
    lists: [
      {
        id: "bl-week",
        name: "This week",
        items: [
          { title: "Renew my passport", due: 4 },
          {
            title: "Plan the trip to Lapland",
            status: "in_progress",
            children: [
              { title: "Find a cabin", status: "done" },
              { title: "Book the night train", due: 2 },
              { title: "Borrow warm boots" },
            ],
          },
          { title: "Call the plumber" },
        ],
      },
      {
        id: "bl-someday",
        name: "Someday",
        items: [{ title: "Learn to sail" }, { title: "Read: The Mythical Man-Month" }, { title: "Repaint the shed" }],
      },
    ],
  },
  {
    id: "bt-team",
    name: "Team",
    lists: [
      {
        id: "bl-backlog",
        name: "Backlog",
        items: [
          { title: "Customer feedback survey" },
          { title: "Onboarding checklist for new hires", children: [{ title: "Laptop and accounts" }, { title: "First-week buddy" }] },
          { title: "Dark mode for the website" },
        ],
      },
      {
        id: "bl-sprint",
        name: "Sprint 12",
        board: true,
        items: [
          { title: "Fix the sign-in timeout", status: "in_progress" },
          { title: "Update the pricing page" },
          { title: "Write the release notes", status: "done" },
          { title: "Prepare the demo", due: 5 },
        ],
      },
    ],
  },
];

/**
 * The example organisation, its ids scoped to DEMO_ORG as the app expects.
 * Deadlines count from today; the items were made createdDaysAgo, so the
 * checklist a brand-new account gets does not show.
 */
export function demoContent(today = new Date(), createdDaysAgo = 30): MockDataSnapshot & { seedItemIds: Set<string> } {
  const workItems: Record<string, WorkItem> = {};
  const backlogs: Record<string, Backlog> = {};
  const backlogTrees: Record<string, BacklogTree> = {};
  let n = 0;
  const due = (days: number) => toIsoDate(new Date(today.getTime() + days * 86_400_000));
  const created = toIsoDate(new Date(today.getTime() - createdDaysAgo * 86_400_000));

  TREES.forEach((tree, treeRank) => {
    backlogTrees[tree.id] = { id: tree.id, name: tree.name, rank: treeRank, rootBacklogIds: tree.lists.map((l) => l.id) };
    tree.lists.forEach((list, listRank) => {
      backlogs[list.id] = {
        id: list.id,
        name: list.name,
        parentId: null,
        childrenIds: [],
        treeId: tree.id,
        rank: listRank,
        ...(list.board ? { viewMode: "board" as const } : {}),
      } as Backlog;
      const add = (specs: Spec[], parentId: string | null): string[] =>
        specs.map((spec, rank) => {
          const id = `wi-demo${String(++n).padStart(3, "0")}`;
          workItems[id] = {
            id,
            title: spec.title,
            status: spec.status ?? "not_started",
            parentId,
            childrenIds: [],
            backlogAssignments: { [tree.id]: list.id },
            ranks: { [list.id]: rank },
            boardRanks: { [list.id]: rank },
            organizationId: DEMO_ORG,
            createdOn: created,
            ...(spec.due !== undefined ? { deadline: due(spec.due) } : {}),
          } as WorkItem;
          workItems[id].childrenIds = add(spec.children ?? [], id);
          return id;
        });
      add(list.items, null);
    });
  });

  const scoped = scopeMockDataToOrganization(DEMO_ORG, { workItems, backlogs, backlogTrees });
  return { ...scoped, seedItemIds: new Set(Object.keys(scoped.workItems)) };
}

/** The items the visitor made, as an outline in the order the app shows them. */
export function visitorOutline(
  items: Record<string, WorkItem>,
  backlogs: Record<string, Backlog>,
  trees: Record<string, BacklogTree>,
  seed: Set<string>,
): TryItem[] {
  const out: TryItem[] = [];
  const seen = new Set<string>();
  const byRank = (listId: string) => (a: string, b: string) =>
    (items[a]?.ranks[listId] ?? 0) - (items[b]?.ranks[listId] ?? 0);
  const visit = (id: string, listId: string, depth: number) => {
    const item = items[id];
    if (!item || seen.has(id)) return;
    seen.add(id);
    const mine = !seed.has(id);
    if (mine) out.push({ id, title: item.title, depth, done: item.status === "done" });
    [...item.childrenIds].sort(byRank(listId)).forEach((child) => visit(child, listId, mine ? depth + 1 : depth));
  };
  const visitList = (treeId: string, listId: string) => {
    Object.values(items)
      .filter((it) => it.backlogAssignments[treeId] === listId && (!it.parentId || !items[it.parentId]))
      .map((it) => it.id)
      .sort(byRank(listId))
      .forEach((id) => visit(id, listId, 0));
    [...(backlogs[listId]?.childrenIds ?? [])]
      .sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0))
      .forEach((child) => visitList(treeId, child));
  };
  Object.values(trees)
    .sort((a, b) => a.rank - b.rank)
    .forEach((tree) =>
      [...tree.rootBacklogIds]
        .sort((a, b) => (backlogs[a]?.rank ?? 0) - (backlogs[b]?.rank ?? 0))
        .forEach((listId) => visitList(tree.id, listId)),
    );
  return out;
}
