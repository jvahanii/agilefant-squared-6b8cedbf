/**
 * The table of shortcuts (lib/shortcuts.ts): a key press is one shortcut at
 * most, whatever order the table lists them in, and every shortcut says how it
 * is pressed and what it does, so the guide and the overlay can list it.
 */
import { describe, it, expect } from "vitest";
import { SHORTCUTS, SHORTCUT_GROUPS, shortcutRowsByGroup } from "@/lib/shortcuts";

const KEYS = [
  "a", "b", "d", "h", "i", "k", "l", "m", "n", "o", "p", "q", "r", "t", "u", "y", "z", "?", "/",
  "Enter", "Escape", "Delete", "Backspace", "F2", "Tab", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight",
];

function* presses() {
  for (const key of KEYS) {
    for (let mods = 0; mods < 16; mods++) {
      const shiftKey = !!(mods & 1);
      const ctrlKey = !!(mods & 2);
      const altKey = !!(mods & 4);
      const metaKey = !!(mods & 8);
      // A shifted letter arrives in upper case, as it does from a keyboard.
      const shown = shiftKey && key.length === 1 ? key.toUpperCase() : key;
      yield new KeyboardEvent("keydown", { key: shown, shiftKey, ctrlKey, altKey, metaKey });
    }
  }
}

describe("the shortcuts", () => {
  it("never answer the same key press twice", () => {
    for (const e of presses()) {
      const matching = SHORTCUTS.filter((s) => s.matches?.(e)).map((s) => s.id);
      expect(matching.length, `${e.ctrlKey ? "Ctrl+" : ""}${e.metaKey ? "Cmd+" : ""}${e.altKey ? "Alt+" : ""}${e.shiftKey ? "Shift+" : ""}${e.key}: ${matching.join(", ")}`).toBeLessThanOrEqual(1);
    }
  });

  it("each say how they are pressed and what they do, in a section the guide has", () => {
    const ids = new Set<string>();
    for (const s of SHORTCUTS) {
      expect(ids.has(s.id), s.id).toBe(false);
      ids.add(s.id);
      expect(SHORTCUT_GROUPS).toContain(s.group);
      expect(s.rows.length, s.id).toBeGreaterThan(0);
      for (const row of s.rows) {
        expect(row.keys.length, s.id).toBeGreaterThan(0);
        expect(row.description.trim(), s.id).not.toBe("");
      }
      // One that is pressed here also does something here.
      expect(!!s.matches, s.id).toBe(!!s.run);
    }
  });

  it("are all listed, section by section, for the guide and the overlay", () => {
    const listed = shortcutRowsByGroup().flatMap((g) => g.rows);
    expect(listed).toHaveLength(SHORTCUTS.reduce((n, s) => n + s.rows.length, 0));
    // The ones the overlay used to leave out are there.
    const descriptions = listed.map((r) => r.description).join("\n");
    for (const expected of ["Collapse", "Assign teams", "Duplicate", "Rename", "Indent"]) {
      expect(descriptions).toContain(expected);
    }
  });
});
