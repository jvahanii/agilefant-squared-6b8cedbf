/**
 * Undoing a delete, against a database that behaves like the real one.
 *
 * On 2026-09-16 21 work items came back from a delete without their job-posting
 * links. bulk_delete_work_items deletes the work_items rows and every child
 * table cascades. Undo only swapped the local snapshot back, so the items
 * existed nowhere but in the page, until the next edit re-saved them through a
 * plain upsert: the row and its ranks returned, the hyperlinks did not.
 *
 * The fake below keeps just enough of that database to show it: work item rows,
 * rank rows and hyperlinks, all cascading on delete, and the copy the delete
 * RPC now keeps so a restore can put everything back.
 */
import { describe, it, expect, beforeEach, vi } from "vitest";
import type { Hyperlink, WorkItem } from "@/types/models";

type Row = Omit<WorkItem, "childrenIds" | "ranks" | "boardRanks">;

const db = vi.hoisted(() => ({
  items: new Map<string, Row>(),
  ranks: new Map<string, number>(),
  boardRanks: new Map<string, number>(),
  hyperlinks: new Map<string, Hyperlink>(),
  archive: new Map<string, { row: Row; ranks: [string, number][]; boardRanks: [string, number][]; hyperlinks: Hyperlink[] }>(),
  failItemUpserts: false,
  structure: { backlogs: {}, backlogTrees: {} } as { backlogs: Record<string, unknown>; backlogTrees: Record<string, unknown> },
}));

vi.mock("@/store/supabaseSync", () => {
  const rankKey = (workItemId: string, backlogId: string) => `${workItemId}|${backlogId}`;
  const writeItems = (items: WorkItem[]) => {
    for (const { childrenIds: _c, ranks, boardRanks: _b, ...row } of items) {
      db.items.set(row.id, { ...row });
      for (const [backlogId, rank] of Object.entries(ranks)) db.ranks.set(rankKey(row.id, backlogId), rank);
    }
  };
  const writeRankRows = (target: Map<string, number>, rows: Array<{ workItemId: string; backlogId: string; rank: number }>) => {
    const missing = new Set<string>();
    for (const r of rows) {
      if (!db.items.has(r.workItemId)) missing.add(r.workItemId);
      else target.set(rankKey(r.workItemId, r.backlogId), r.rank);
    }
    return { ok: true, missingWorkItemIds: [...missing] };
  };
  const childKeys = (map: Map<string, unknown>, id: string) => [...map.keys()].filter((k) => k.startsWith(`${id}|`));
  return {
    loadFromSupabase: vi.fn(async () => {
      const workItems: Record<string, WorkItem> = {};
      for (const row of db.items.values()) workItems[row.id] = { ...row, childrenIds: [], ranks: {}, boardRanks: {} };
      for (const [key, rank] of db.ranks) {
        const [id, backlogId] = key.split("|");
        if (workItems[id]) workItems[id].ranks[backlogId] = rank;
      }
      return { workItems, ...structuredClone(db.structure) };
    }),
    upsertWorkItem: vi.fn(async (item: WorkItem) => { if (db.failItemUpserts) return false; writeItems([item]); return true; }),
    upsertWorkItems: vi.fn(async (items: WorkItem[]) => { if (db.failItemUpserts) return false; writeItems(items); return true; }),
    deleteWorkItems: vi.fn(async (ids: string[]) => {
      // What the real delete does first, so the store sees the same registry.
      (await import("@/store/deletedWorkItems")).markWorkItemsDeleted(ids);
      for (const id of ids) {
        const row = db.items.get(id);
        if (!row) continue;
        db.archive.set(id, {
          row,
          ranks: childKeys(db.ranks, id).map((k) => [k, db.ranks.get(k)!]),
          boardRanks: childKeys(db.boardRanks, id).map((k) => [k, db.boardRanks.get(k)!]),
          hyperlinks: [...db.hyperlinks.values()].filter((l) => l.workItemId === id),
        });
        db.items.delete(id);
        childKeys(db.ranks, id).forEach((k) => db.ranks.delete(k));
        childKeys(db.boardRanks, id).forEach((k) => db.boardRanks.delete(k));
        for (const [linkId, link] of db.hyperlinks) if (link.workItemId === id) db.hyperlinks.delete(linkId);
      }
    }),
    // Like restore_deleted_work_items: in call order, and never over a row
    // that is already there (ON CONFLICT DO NOTHING).
    restoreWorkItems: vi.fn(async (items: WorkItem[]) => {
      for (const { id } of items) {
        const copy = db.archive.get(id);
        if (!copy) continue;
        if (!db.items.has(id)) db.items.set(id, copy.row);
        copy.ranks.forEach(([k, v]) => { if (!db.ranks.has(k)) db.ranks.set(k, v); });
        copy.boardRanks.forEach(([k, v]) => { if (!db.boardRanks.has(k)) db.boardRanks.set(k, v); });
        copy.hyperlinks.forEach((l) => { if (!db.hyperlinks.has(l.id)) db.hyperlinks.set(l.id, l); });
        db.archive.delete(id);
      }
      (await import("@/store/deletedWorkItems")).forgetDeletedWorkItems(items.map((wi) => wi.id));
      return true;
    }),
    upsertWorkItemBacklogRankRows: vi.fn(async (rows) => writeRankRows(db.ranks, rows).ok),
    upsertWorkItemBacklogRankRowsDetailed: vi.fn(async (rows) => writeRankRows(db.ranks, rows)),
    upsertWorkItemBoardRankRows: vi.fn(async (rows) => writeRankRows(db.boardRanks, rows).ok),
    upsertWorkItemBoardRankRowsDetailed: vi.fn(async (rows) => writeRankRows(db.boardRanks, rows)),
    deleteWorkItemBoardRanks: vi.fn(async () => {}),
    deleteWorkItemBacklogRanks: vi.fn(async () => {}),
    upsertBacklog: vi.fn(),
    updateBacklogViewMode: vi.fn(),
    upsertBacklogs: vi.fn(async () => {}),
    deleteBacklogs: vi.fn(async () => {}),
    upsertBacklogTree: vi.fn(),
    deleteBacklogTree: vi.fn(async () => {}),
    upsertBacklogTrees: vi.fn(async () => {}),
    resetOrgData: vi.fn(),
    loadHyperlinksForWorkItems: vi.fn(async () => {
      const byItem: Record<string, Hyperlink[]> = {};
      for (const link of db.hyperlinks.values()) (byItem[link.workItemId] ??= []).push(link);
      return byItem;
    }),
    upsertHyperlink: vi.fn(async (link: Hyperlink) => { if (db.items.has(link.workItemId)) db.hyperlinks.set(link.id, link); }),
    deleteHyperlink: vi.fn(async (id: string) => { db.hyperlinks.delete(id); }),
    registerWorkItemRenameCallback: vi.fn(),
  };
});

import { useAppStore } from "@/store/appStore";
import { upsertWorkItems } from "@/store/supabaseSync";

let orgCounter = 0;
let ORG = "";
let TREE = "";
let BACKLOG = "";

const settle = async () => {
  for (let i = 0; i < 10; i++) await new Promise((resolve) => setTimeout(resolve, 0));
};

function item(id: string, title: string, rank: number, parentId: string | null = null): WorkItem {
  return {
    id, title, status: "not_started", parentId, childrenIds: [], organizationId: ORG,
    backlogAssignments: { [TREE]: BACKLOG }, ranks: { [BACKLOG]: rank }, boardRanks: {},
  };
}

/** One posting in the database and on screen, with the link the import gave it. */
function seedPosting() {
  const id = `${ORG}::wi-posting`;
  const posting = item(id, "Elisa — Team Manager, AI Development (Helsinki)", 0);
  const other = item(`${ORG}::wi-other`, "Another posting", 1);
  const link: Hyperlink = { id: "link-1", workItemId: id, url: "https://www.linkedin.com/jobs/view/4465791712", altText: posting.title, rank: 0 };
  for (const wi of [posting, other]) {
    const { childrenIds: _c, ranks: _r, boardRanks: _b, ...row } = wi;
    db.items.set(wi.id, row);
    db.ranks.set(`${wi.id}|${BACKLOG}`, wi.ranks[BACKLOG]);
  }
  db.hyperlinks.set(link.id, link);
  db.structure = {
    backlogTrees: { [TREE]: { id: TREE, name: "Jobs", rootBacklogIds: [BACKLOG], rank: 0 } },
    backlogs: { [BACKLOG]: { id: BACKLOG, name: "Explicit deadline", parentId: null, childrenIds: [], treeId: TREE, rank: 0 } },
  };
  useAppStore.setState({
    organizationId: ORG,
    ...(structuredClone(db.structure) as object),
    workItems: { [posting.id]: posting, [other.id]: other },
    hyperlinks: { [id]: [link] },
    selectedTreeId: TREE, selectedBacklogIds: [BACKLOG], selectedWorkItemIds: [],
    undoStack: [], redoStack: [], isLoading: false,
  });
  return { id, link };
}

beforeEach(() => {
  orgCounter++;
  ORG = `undo-org-${orgCounter}`;
  TREE = `${ORG}::bt-1`;
  BACKLOG = `${ORG}::bl-1`;
  db.items.clear(); db.ranks.clear(); db.boardRanks.clear(); db.hyperlinks.clear(); db.archive.clear();
  db.failItemUpserts = false;
  localStorage.clear();
  vi.mocked(upsertWorkItems).mockClear();
  useAppStore.setState({
    workItems: {}, backlogs: {}, backlogTrees: {}, hyperlinks: {}, changeLog: [],
    expandedWorkItems: new Set(), expandedBacklogs: new Set(),
    undoStack: [], redoStack: [], organizationId: null, userId: null,
  });
});

describe("undoing a delete", () => {
  it("does not wait for another edit: the item, its rank and its link are back in the database", async () => {
    const { id } = seedPosting();

    useAppStore.getState().deleteWorkItemsBulk([id]);
    await settle();
    expect(db.items.has(id)).toBe(false);
    expect(db.hyperlinks.size).toBe(0);

    useAppStore.getState().undo();
    await settle();

    expect(db.items.has(id)).toBe(true);
    expect(db.ranks.get(`${id}|${BACKLOG}`)).toBe(0);
    expect([...db.hyperlinks.values()].map((l) => l.workItemId)).toEqual([id]);
  });

  it("keeps the link when the restored item is edited afterwards — the 2026-09-16 sequence", async () => {
    // Delete, Ctrl+Z, then change the item's status. Before the fix the status
    // change was what put the item back, through upsertWorkItem, without its link.
    const { id } = seedPosting();

    useAppStore.getState().deleteWorkItemsBulk([id]);
    await settle();
    useAppStore.getState().undo();
    useAppStore.getState().setWorkItemStatus(id, "done");
    await settle();

    expect(db.items.get(id)?.status).toBe("done");
    expect([...db.hyperlinks.values()].map((l) => l.url)).toEqual(["https://www.linkedin.com/jobs/view/4465791712"]);
  });

  it("deletes it again on redo", async () => {
    const { id } = seedPosting();

    useAppStore.getState().deleteWorkItemsBulk([id]);
    await settle();
    useAppStore.getState().undo();
    await settle();
    useAppStore.getState().redo();
    await settle();

    expect(useAppStore.getState().workItems[id]).toBeUndefined();
    expect(db.items.has(id)).toBe(false);
  });

  it("removes from the database an item whose creation is undone", async () => {
    seedPosting();

    useAppStore.getState().addWorkItem("Typo", null, BACKLOG, TREE);
    await settle();
    const created = Object.values(useAppStore.getState().workItems).find((wi) => wi.title === "Typo")!;
    expect(db.items.has(created.id)).toBe(true);

    useAppStore.getState().undo();
    await settle();

    expect(db.items.has(created.id)).toBe(false);
  });

  it("writes back an undone edit", async () => {
    const { id } = seedPosting();

    useAppStore.getState().renameWorkItem(id, "Renamed by mistake");
    await settle();
    useAppStore.getState().undo();
    await settle();

    expect(db.items.get(id)?.title).toBe("Elisa — Team Manager, AI Development (Helsinki)");
  });
});

describe("a queued save for an item deleted on purpose", () => {
  it("is not shown again when its realtime echo arrives after the delete", async () => {
    const { id } = seedPosting();

    useAppStore.getState().deleteWorkItemsBulk([id]);
    await settle();
    useAppStore.getState().applyRealtimeWorkItem("UPDATE", {
      id, title: "Elisa — Team Manager, AI Development (Helsinki)", status: "done",
      parent_id: null, backlog_assignments: { [TREE]: BACKLOG }, organization_id: ORG,
    });

    expect(useAppStore.getState().workItems[id]).toBeUndefined();
  });

  it("does not bring the item back on the next load", async () => {
    seedPosting();
    // The save of a new item fails (offline, expired session), so it stays in
    // the retry queue in localStorage.
    db.failItemUpserts = true;
    useAppStore.getState().addWorkItem("Unwanted", null, BACKLOG, TREE);
    await settle();
    const unwanted = Object.values(useAppStore.getState().workItems).find((wi) => wi.title === "Unwanted")!;
    expect(localStorage.getItem("pending_work_item_upserts")).toContain(unwanted.id);

    // The user deletes it, the connection comes back, the page reloads.
    useAppStore.getState().deleteWorkItemsBulk([unwanted.id]);
    await settle();
    db.failItemUpserts = false;
    vi.mocked(upsertWorkItems).mockClear();
    useAppStore.setState({ workItems: {}, undoStack: [], redoStack: [] });
    await useAppStore.getState().loadFromSupabase();
    await settle();

    expect(db.items.has(unwanted.id)).toBe(false);
    expect(useAppStore.getState().workItems[unwanted.id]).toBeUndefined();
    const written = vi.mocked(upsertWorkItems).mock.calls.flatMap(([items]) => items.map((wi) => wi.id));
    expect(written).not.toContain(unwanted.id);
  });
});
