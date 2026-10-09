/**
 * Which items a scramble or an unscramble takes in.
 *
 * Scrambling an item scrambles everything under it, and unscrambling it puts
 * those back — a hidden name with its work readable beneath has hidden nothing.
 * Pinned here: that every level below is taken in, by whichever parent an item
 * has in any tree; that nothing is counted twice; and what each action leaves
 * out — what is already scrambled, and what somebody else scrambled.
 */
import { describe, it, expect } from "vitest";
import { idsToScramble, idsToUnscramble, withDescendants } from "@/lib/scrambleScope";

const item = (id: string, parentId: string | null = null, parentIds?: Record<string, string | null>) => ({
  id,
  parentId,
  ...(parentIds ? { parentIds } : {}),
});
const items = (...list: ReturnType<typeof item>[]) => Object.fromEntries(list.map((i) => [i.id, i]));

// offer
//   ├─ call
//   │    └─ notes
//   └─ contract
// other
const TREE = items(item("offer"), item("call", "offer"), item("notes", "call"), item("contract", "offer"), item("other"));

describe("an item and everything under it", () => {
  it("takes in every level below", () => {
    expect(withDescendants(["offer"], TREE)).toEqual(["offer", "call", "contract", "notes"]);
  });

  it("is the item alone when nothing is under it", () => {
    expect(withDescendants(["other"], TREE)).toEqual(["other"]);
    expect(withDescendants(["notes"], TREE)).toEqual(["notes"]);
  });

  it("counts an item once, however it was reached", () => {
    // A parent and its own child both selected.
    expect(withDescendants(["offer", "call"], TREE)).toEqual(["offer", "call", "contract", "notes"]);
    expect(withDescendants(["call", "offer"], TREE)).toEqual(["call", "offer", "notes", "contract"]);
  });

  it("takes in a child an item has in another tree only", () => {
    // "brief" sits at the top level ordinarily, and under "offer" in one tree.
    const withTreeParent = { ...TREE, ...items(item("brief", null, { "tree-2": "offer" })) };
    expect(withDescendants(["offer"], withTreeParent)).toContain("brief");
  });

  it("still takes in a child that one tree shows at the top level", () => {
    // Under "offer" ordinarily; a root in tree-2. It is the item's child all the same.
    const rootElsewhere = { ...TREE, ...items(item("memo", "offer", { "tree-2": null })) };
    expect(withDescendants(["offer"], rootElsewhere)).toContain("memo");
  });

  it("does not loop on items that name each other as parents", () => {
    const loop = items(item("a", "b"), item("b", "a"));
    expect(withDescendants(["a"], loop).sort()).toEqual(["a", "b"]);
  });
});

describe("scrambling", () => {
  it("scrambles the item and everything under it", () => {
    expect(idsToScramble(["offer"], TREE, new Map())).toEqual(["offer", "call", "contract", "notes"]);
  });

  it("leaves what is already scrambled, by anyone, and goes on to the rest", () => {
    const scrambled = new Map<string, string | null>([["call", "me"], ["contract", "someone-else"]]);
    expect(idsToScramble(["offer"], TREE, scrambled)).toEqual(["offer", "notes"]);
  });

  it("leaves out a selected item that is no longer there", () => {
    expect(idsToScramble(["gone", "other"], TREE, new Map())).toEqual(["other"]);
  });
});

describe("unscrambling", () => {
  const scrambled = new Map<string, string | null>([
    ["offer", "me"],
    ["call", "me"],
    ["notes", "someone-else"],
    ["other", "me"],
  ]);

  it("puts back the item and everything under it that this person scrambled", () => {
    expect(idsToUnscramble(["offer"], TREE, scrambled, "me")).toEqual(["offer", "call"]);
  });

  it("leaves alone what somebody else scrambled, and what was never scrambled", () => {
    const out = idsToUnscramble(["offer"], TREE, scrambled, "me");
    expect(out).not.toContain("notes");
    expect(out).not.toContain("contract");
  });

  it("does not reach outside what is under the item", () => {
    expect(idsToUnscramble(["offer"], TREE, scrambled, "me")).not.toContain("other");
  });

  it("is nothing for somebody who scrambled none of it", () => {
    expect(idsToUnscramble(["offer"], TREE, scrambled, "a-third")).toEqual([]);
    expect(idsToUnscramble(["offer"], TREE, scrambled, null)).toEqual([]);
  });
});
