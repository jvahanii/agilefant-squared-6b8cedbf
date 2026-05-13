import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { resolve } from "path";

// Root cause of the mobile duplicate-buttons bug:
//
//   On mobile, touching a backlog row activates the CSS :hover pseudo-class
//   (touch-hover emulation present in most mobile browsers).  In BacklogTreePanel,
//   the desktop hover-actions <div> used "hidden group-hover:flex" — without the
//   "md:" breakpoint prefix.  When a mobile user tapped a row the touch-hover
//   state fired group-hover:flex, making the desktop action buttons (+ and the
//   time-log button) visible at the same time as the mobile selection bar actions,
//   doubling up those buttons on screen.
//
//   The same root cause extends to any group-hover:* utility that is not gated
//   behind the md: breakpoint: without the prefix the utility fires on mobile
//   touch-hover and produces unexpected visual glitches.

const BACKLOG_PANEL_PATH = resolve(
  __dirname,
  "../components/BacklogTreePanel.tsx"
);

describe("BacklogTreePanel — group-hover utilities must be gated behind md: on mobile", () => {
  it("desktop hover-actions must use md:group-hover:flex, not bare group-hover:flex (fixes duplicate + / time-log buttons on mobile)", () => {
    const source = readFileSync(BACKLOG_PANEL_PATH, "utf-8");

    // The buggy pattern: group-hover:flex with no breakpoint prefix is triggered
    // by mobile touch-hover, revealing desktop actions on phones alongside the
    // mobile selection-bar actions and duplicating the + and time-log buttons.
    expect(
      source,
      'Found "hidden group-hover:flex" without md: prefix — ' +
        "activates desktop hover-actions on mobile touch and duplicates the + / time-log buttons"
    ).not.toMatch(/\bhidden group-hover:flex\b/);
  });

  it("points badge must use md:group-hover:hidden so it stays visible on mobile touch", () => {
    const source = readFileSync(BACKLOG_PANEL_PATH, "utf-8");

    // The points count <span> carries "group-hover:hidden" without "md:".
    // On mobile, any touch on the row activates the :hover pseudo-class; that
    // makes group-hover:hidden fire, erasing the points badge for non-selected
    // rows even though no replacement buttons appear.  The utility should be
    // "md:group-hover:hidden" so it only hides the badge on desktop hover where
    // the hover-actions div actually expands to replace it.
    expect(
      source,
      'Found "group-hover:hidden" without md: prefix — ' +
        "hides the points badge on mobile touch even when no action buttons appear to replace it"
    ).not.toMatch(/(?<![:\w])group-hover:hidden\b/);
  });
});
