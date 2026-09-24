/**
 * What a typed duration means.
 *
 * Every plain number used to be hours, so "45" typed as minutes went in as 45
 * hours, and two such entries — 30h and 45h — made up most of a month's
 * report. A whole number is minutes now, and a decimal is hours.
 */
import { describe, it, expect } from "vitest";
import { parseDuration } from "@/lib/parseDuration";
import { formatDuration } from "@/lib/formatDuration";

describe("parseDuration", () => {
  it("reads a whole number as minutes", () => {
    expect(parseDuration("45")).toBe(45);
    expect(parseDuration("30")).toBe(30);
    expect(parseDuration(" 90 ")).toBe(90);
  });

  it("reads a decimal as hours, with a point or a comma", () => {
    expect(parseDuration("1.5")).toBe(90);
    expect(parseDuration("1,5")).toBe(90);
    expect(parseDuration("0.25")).toBe(15);
    expect(parseDuration(".5")).toBe(30);
  });

  it("reads units as written", () => {
    expect(parseDuration("30m")).toBe(30);
    expect(parseDuration("30 min")).toBe(30);
    expect(parseDuration("2h")).toBe(120);
    expect(parseDuration("1.5h")).toBe(90);
    expect(parseDuration("1h 30m")).toBe(90);
    expect(parseDuration("1h30")).toBe(90);
  });

  it("refuses what is not a duration", () => {
    expect(parseDuration("")).toBeNull();
    expect(parseDuration("0")).toBeNull();
    expect(parseDuration("0.0")).toBeNull();
    expect(parseDuration("abc")).toBeNull();
    expect(parseDuration("-5")).toBeNull();
    expect(parseDuration("45 minutes ago")).toBeNull();
  });

  it("reads back exactly what the dialogs prefill and edit", () => {
    // Every duration shown in a field comes from formatDuration, so it must
    // survive the round trip — "45m", never a bare "45" read another way.
    for (const minutes of [1, 30, 45, 59, 60, 90, 125, 480, 2700]) {
      expect(parseDuration(formatDuration(minutes))).toBe(minutes);
    }
  });
});
