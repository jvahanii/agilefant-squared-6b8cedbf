/**
 * Filters typed into the search box as a command: "/due today".
 *
 * Pinned here: that the command is recognised however it is typed, that it
 * finds the items whose deadline is today on the reader's own calendar and no
 * others, that a date at the start of a name counts where there is no deadline
 * field, and that anything else is left to the ordinary search by title.
 */
import { describe, it, expect } from "vitest";
import { dueDay, searchFilter } from "@/lib/searchFilters";

// Midday on 9 October 2026, local time.
const NOW = new Date(2026, 9, 9, 12);
const item = (title: string, deadline?: string) => ({ title, deadline });

describe("/scrambled", () => {
  const scrambled = new Set(["wi-2"]);
  const filter = searchFilter("/Scrambled ", NOW, scrambled)!;

  it("finds the items whose name is scrambled, by what they are rather than how they read", () => {
    expect(filter).not.toBeNull();
    expect(filter.matches({ id: "wi-1", title: "Snorkmaiden" })).toBe(false);
    expect(filter.matches({ id: "wi-2", title: "SNORKMAIDEN" })).toBe(true);
  });

  it("finds nothing when nothing is, and says so", () => {
    const none = searchFilter("/scrambled", NOW)!;
    expect(none.matches({ id: "wi-2", title: "SNORKMAIDEN" })).toBe(false);
    expect(none.nothingFound).toBe("No items are scrambled");
  });
});

describe("/due today", () => {
  const filter = searchFilter("/due today", NOW)!;

  it("is a filter, not a search for those words", () => {
    expect(filter).not.toBeNull();
  });

  it("finds what is due today, and nothing due any other day", () => {
    expect(filter.matches(item("Send the offer", "2026-10-09"))).toBe(true);
    expect(filter.matches(item("Yesterday's", "2026-10-08"))).toBe(false);
    expect(filter.matches(item("Tomorrow's", "2026-10-10"))).toBe(false);
    expect(filter.matches(item("Same day last year", "2025-10-09"))).toBe(false);
  });

  it("does not find an item with no deadline — even one named for it", () => {
    expect(filter.matches(item("No deadline"))).toBe(false);
    expect(filter.matches(item("/due today"))).toBe(false);
  });

  it("counts the date a name starts with, where an item has no deadline of its own", () => {
    expect(filter.matches(item("1009 Fennia - Product owner"))).toBe(true);
    expect(filter.matches(item("1010 Fennia - Product owner"))).toBe(false);
    // The deadline, where there is one, is what counts.
    expect(filter.matches(item("1009 Fennia - Product owner", "2026-10-20"))).toBe(false);
  });

  it("goes by the reader's own day, late in the evening and early in the morning", () => {
    const lateEvening = searchFilter("/due today", new Date(2026, 9, 9, 23, 30))!;
    expect(lateEvening.matches(item("x", "2026-10-09"))).toBe(true);
    expect(lateEvening.matches(item("x", "2026-10-10"))).toBe(false);
    const earlyMorning = searchFilter("/due today", new Date(2026, 9, 9, 0, 30))!;
    expect(earlyMorning.matches(item("x", "2026-10-09"))).toBe(true);
    expect(earlyMorning.matches(item("x", "2026-10-08"))).toBe(false);
  });

  it("is recognised whatever the capitals and spacing", () => {
    for (const typed of ["/due today", "/Due Today", "  /due   today  ", "/DUE TODAY"]) {
      expect(searchFilter(typed, NOW), typed).not.toBeNull();
    }
  });

  it("says so when nothing is due", () => {
    expect(filter.nothingFound).toBe("No items are due today");
  });
});

describe("anything else", () => {
  it("is an ordinary search", () => {
    for (const typed of ["due today", "/due", "/due tod", "/due todays", "/due today please", "offer", "", "/"]) {
      expect(searchFilter(typed, NOW), typed).toBeNull();
    }
  });
});

describe("the day an item is due", () => {
  it("is its deadline, else the date its name starts with, else none", () => {
    expect(dueDay(item("Offer", "2026-10-20"), NOW)).toBe("2026-10-20");
    expect(dueDay(item("1009 Offer"), NOW)).toBe("2026-10-09");
    expect(dueDay(item("Offer"), NOW)).toBeUndefined();
  });
});
