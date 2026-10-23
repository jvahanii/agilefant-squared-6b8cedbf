/**
 * A plain left click on a selected item opens its name for editing, the way a
 * file manager renames. Everything else a row click can be — first click on an
 * unselected row, Ctrl/Cmd or Shift clicks, taps on a phone, clicks inside a
 * multi-selection — keeps doing what selecting does.
 */
import { describe, it, expect } from "vitest";
import { rowClickIntent } from "@/lib/rowClick";

const base = { isMulti: false, isShift: false, isMobile: false, isSelected: true, isMultiSelected: false };

describe("a left click on a selected item", () => {
  it("renames it", () => {
    expect(rowClickIntent(base)).toBe("rename");
  });

  it("only selects when the row was not yet selected", () => {
    expect(rowClickIntent({ ...base, isSelected: false })).toBe("select");
  });

  it("only selects when the click carries Ctrl, Cmd or Shift", () => {
    expect(rowClickIntent({ ...base, isMulti: true })).toBe("select");
    expect(rowClickIntent({ ...base, isShift: true })).toBe("select");
  });

  it("only selects while several items are selected", () => {
    expect(rowClickIntent({ ...base, isMultiSelected: true })).toBe("select");
  });

  it("only selects on a phone, where the tap already has work to do", () => {
    expect(rowClickIntent({ ...base, isMobile: true })).toBe("select");
  });
});
