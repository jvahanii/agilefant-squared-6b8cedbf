/**
 * Ported from supabase/functions/whatsapp-message-received/split_test.ts, which
 * was written as a Deno test and so never ran: vitest only collects
 * src/**\/*.{test,spec}.ts, and it cannot execute Deno.test or resolve
 * deno.land imports. The cases are worth keeping — a change to the splitting
 * rules silently reshapes what arrives in people's backlogs — so they live here
 * where CI actually runs them.
 *
 * The module under test is plain TypeScript with no Deno APIs, so it imports
 * directly from the function directory rather than being duplicated.
 */
import { describe, it, expect } from "vitest";
import { splitMessage } from "../../supabase/functions/whatsapp-message-received/split";

describe("splitMessage", () => {
  it("splits on newlines only, by default", () => {
    expect(splitMessage("milk, bread\neggs")).toEqual(["milk, bread", "eggs"]);
  });

  it("splits on a comma delimiter and trims the fragments", () => {
    expect(splitMessage("milk, bread , eggs", { delimiters: "," })).toEqual([
      "milk",
      "bread",
      "eggs",
    ]);
  });

  it("splits on spaces when asked", () => {
    expect(splitMessage("milk bread eggs", { splitOnSpace: true })).toEqual([
      "milk",
      "bread",
      "eggs",
    ]);
  });

  it("treats whitespace in the delimiter field as separation, not a delimiter", () => {
    expect(
      splitMessage("milk / bread | eggs", { splitOnNewline: false, delimiters: "/ |" }),
    ).toEqual(["milk", "bread", "eggs"]);
  });

  it("keeps the whole message as one item when no rule is enabled", () => {
    expect(splitMessage("milk\nbread", { splitOnNewline: false })).toEqual(["milk\nbread"]);
  });

  it("drops fragments shorter than the minimum", () => {
    expect(
      splitMessage("milk,a,bread", { delimiters: ",", minFragmentLength: 2 }),
    ).toEqual(["milk", "bread"]);
  });

  it("escapes delimiters that are special inside a regex character class", () => {
    // '-' and ']' would otherwise form a range or close the class early.
    expect(
      splitMessage("milk-bread]eggs", { splitOnNewline: false, delimiters: "-]" }),
    ).toEqual(["milk", "bread", "eggs"]);
  });

  it("ignores empty fragments from repeated delimiters", () => {
    expect(splitMessage("milk,,bread", { delimiters: "," })).toEqual(["milk", "bread"]);
  });

  it("returns nothing for a body that is only delimiters or whitespace", () => {
    expect(splitMessage("  \n  ")).toEqual([]);
  });
});
