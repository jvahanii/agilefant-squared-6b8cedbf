/**
 * A load asks only for what changed since the copy the browser has, and reads
 * everything again whenever the merged copy cannot be trusted.
 */
import { describe, it, expect, vi } from "vitest";
import { loadOrgRows, rowMirrorTesting, type ChangesRpc, type FullReads, type HyperlinkRow } from "@/store/rowMirror";

const ORG = "org-1";
const item = (id: string, title = id) => ({ id, title, organization_id: ORG, parent_id_overrides: {} });
const link = (id: string, workItemId: string, rank: number): HyperlinkRow => ({ id, work_item_id: workItemId, url: `https://x/${id}`, alt_text: "", rank });

function fullReads(): FullReads & { calls: number } {
  const reads = {
    calls: 0,
    items: async () => {
      reads.calls += 1;
      return [item("a"), item("b"), item("c")];
    },
    ranks: async () => ({ backlog: { a: { L: 1 }, b: { L: 2 } }, board: { a: { L: 1.5 } } }),
    hyperlinks: async () => [link("h1", "a", 0), link("h2", "b", 0)],
  };
  return reads;
}

const counts = (items: number, backlogRanks: number, boardRanks: number, hyperlinks: number) => ({ items, backlogRanks, boardRanks, hyperlinks });
const none = { items: [], backlogRanks: [], boardRanks: [], hyperlinks: [], deleted: [] };

describe("the organization's rows", () => {
  it("are read in full the first time, then only what changed is asked for", async () => {
    const asked: Array<string | null> = [];
    let answer: Awaited<ReturnType<ChangesRpc>> = {
      now: "2026-11-05T10:00:00.000Z", counts: counts(3, 2, 1, 2), ...none,
      items: null, backlogRanks: null, boardRanks: null, hyperlinks: null, deleted: null,
    };
    const rpc: ChangesRpc = async (_org, since) => {
      asked.push(since);
      return answer;
    };
    const reads = fullReads();
    const first = await loadOrgRows(ORG, reads, rpc);
    expect(first.items.map((r) => r.id)).toEqual(["a", "b", "c"]);
    expect(reads.calls).toBe(1);

    // Since then: b renamed, c deleted, a moved to list M, a link added.
    answer = {
      now: "2026-11-05T11:00:00.000Z",
      counts: counts(2, 2, 1, 3),
      items: [item("b", "renamed")],
      backlogRanks: [["a", "M", 5]],
      boardRanks: [],
      hyperlinks: [link("h3", "a", -1)],
      deleted: [["item", "c"], ["backlog_rank", "a|L"]],
    };
    const second = await loadOrgRows(ORG, reads, rpc);
    expect(reads.calls).toBe(1);
    // Asked from the copy's time, with the overlap.
    expect(asked[1]).toBe("2026-11-05T09:55:00.000Z");
    expect(second.items.map((r) => [r.id, r.title])).toEqual([["a", "a"], ["b", "renamed"]]);
    expect(second.ranks.backlog).toEqual({ a: { M: 5 }, b: { L: 2 } });
    expect(second.hyperlinks.map((l) => l.id)).toEqual(["h3", "h1", "h2"]);
  });

  it("are read in full again when the merged copy does not add up", async () => {
    let n = 0;
    const rpc: ChangesRpc = async () => ({
      now: `2026-11-05T1${n++}:00:00.000Z`,
      // The database has an item the changes never mentioned.
      counts: counts(n === 1 ? 3 : 4, 2, 1, 2),
      ...none,
    });
    const reads = fullReads();
    await loadOrgRows(ORG, reads, rpc);
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await loadOrgRows(ORG, reads, rpc);
    expect(reads.calls).toBe(2);
  });

  it("are read in full when the changes cannot be had", async () => {
    let fail = false;
    const rpc: ChangesRpc = async () => {
      if (fail) throw new Error("timeout");
      return { now: "2026-11-05T10:00:00.000Z", counts: counts(3, 2, 1, 2), ...none };
    };
    const reads = fullReads();
    await loadOrgRows(ORG, reads, rpc);
    fail = true;
    vi.spyOn(console, "warn").mockImplementation(() => {});
    const rows = await loadOrgRows(ORG, reads, rpc);
    expect(reads.calls).toBe(2);
    expect(rows.items).toHaveLength(3);
  });

  it("are asked for once by calls made at the same moment", async () => {
    const rpc = vi.fn<ChangesRpc>(async () => ({ now: "2026-11-05T10:00:00.000Z", counts: counts(3, 2, 1, 2), ...none }));
    const reads = fullReads();
    const [a, b] = await Promise.all([loadOrgRows(ORG, reads, rpc), loadOrgRows(ORG, reads, rpc)]);
    expect(a).toBe(b);
    expect(reads.calls).toBe(1);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("are kept across visits", async () => {
    const rpc: ChangesRpc = async () => ({ now: "2026-11-05T10:00:00.000Z", counts: counts(3, 2, 1, 2), ...none });
    const reads = fullReads();
    await loadOrgRows(ORG, reads, rpc);
    await rowMirrorTesting.writePending();
    rowMirrorTesting.forgetMemory();
    const rows = await loadOrgRows(ORG, reads, rpc);
    expect(reads.calls).toBe(1);
    expect(rows.items).toHaveLength(3);
  });

  it("are not changed by what the app does with them", async () => {
    const rpc: ChangesRpc = async () => ({ now: "2026-11-05T10:00:00.000Z", counts: counts(3, 2, 1, 2), ...none });
    const reads = fullReads();
    const first = await loadOrgRows(ORG, reads, rpc);
    first.ranks.backlog.c = { L: 9 };
    first.ranks.backlog.a.X = 1;
    (first.items[0].parent_id_overrides as Record<string, string>).T = "b";
    const second = await loadOrgRows(ORG, reads, rpc);
    expect(reads.calls).toBe(1);
    expect(second.ranks.backlog).toEqual({ a: { L: 1 }, b: { L: 2 } });
    expect(second.items[0].parent_id_overrides).toEqual({});
  });

  it("are read in full every time while the database cannot say its time", async () => {
    const rpc: ChangesRpc = async () => {
      throw new Error("function get_org_changes does not exist");
    };
    const reads = fullReads();
    await loadOrgRows(ORG, reads, rpc);
    await loadOrgRows(ORG, reads, rpc);
    expect(reads.calls).toBe(2);
  });
});
