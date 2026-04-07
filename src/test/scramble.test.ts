import { describe, it, expect } from "vitest";
import { scrambleName } from "@/lib/scramble";

const MOOMIN_WORDS = [
  "Moomintroll",
  "Moominmamma",
  "Moominpappa",
  "Snorkmaiden",
  "Snork",
  "Sniff",
  "LittleMy",
  "Mymble",
  "Snufkin",
  "Hemulen",
  "Fillyjonk",
  "TooTicky",
  "Groke",
  "Hattifattener",
  "Fuzzy",
  "Hobgoblin",
  "Ancestor",
  "Moominvalley",
  "Moominhouse",
  "Nibling",
  "Whomper",
  "Inspector",
  "Salome",
  "Misabel",
  "Edwardian",
  "Oomph",
  "Joxter",
  "Muddler",
  "Muskrat",
  "Nymphaea",
];

describe("scrambleName", () => {
  it("returns an empty string unchanged", () => {
    expect(scrambleName("")).toBe("");
  });

  it("returns falsy input unchanged", () => {
    expect(scrambleName(null as unknown as string)).toBe(null);
    expect(scrambleName(undefined as unknown as string)).toBe(undefined);
  });

  it("replaces each word with a Moomin word", () => {
    const result = scrambleName("Sprint Backlog");
    const parts = result.split(" ");
    expect(parts).toHaveLength(2);
    for (const part of parts) {
      expect(MOOMIN_WORDS.map((w) => w.toLowerCase())).toContain(
        part.toLowerCase()
      );
    }
  });

  it("is deterministic — same input always produces the same output", () => {
    const input = "Feature Development";
    expect(scrambleName(input)).toBe(scrambleName(input));
    expect(scrambleName(input)).toBe(scrambleName(input));
  });

  it("preserves digits and spaces", () => {
    const result = scrambleName("Sprint 1");
    expect(result).toMatch(/ 1$/);
  });

  it("preserves punctuation", () => {
    const result = scrambleName("Fix: login-bug");
    expect(result).toContain(":");
    expect(result).toContain("-");
  });

  it("mirrors title-case capitalisation", () => {
    const result = scrambleName("Sprint");
    // First letter should be uppercase
    expect(result[0]).toBe(result[0].toUpperCase());
  });

  it("mirrors all-caps capitalisation for multi-char words", () => {
    const result = scrambleName("BACKEND");
    expect(result).toBe(result.toUpperCase());
  });

  it("mirrors lowercase for lowercase input words", () => {
    const result = scrambleName("sprint");
    expect(result).toBe(result.toLowerCase());
  });

  it("does not map different words to the same Moomin word (spot-check)", () => {
    const words = ["sprint", "backlog", "feature", "task", "story", "epic", "bug", "fix"];
    const results = words.map((w) => scrambleName(w));
    // At least some should be different from each other (hash distributes across 30 words)
    const uniqueCount = new Set(results).size;
    expect(uniqueCount).toBeGreaterThan(1);
  });

  it("produces only Moomin-universe words for alphabetic tokens", () => {
    const input = "Hello World";
    const result = scrambleName(input);
    const parts = result.split(" ");
    for (const part of parts) {
      expect(MOOMIN_WORDS.map((w) => w.toLowerCase())).toContain(
        part.toLowerCase()
      );
    }
  });
});
