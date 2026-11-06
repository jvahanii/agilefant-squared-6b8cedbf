/**
 * The day an item is due, which the search's date commands go by (itemSearch.ts).
 */
import { describe, it, expect } from "vitest";
import { dueDay } from "@/lib/searchFilters";

const NOW = new Date(2026, 9, 9, 12);
const item = (title: string, deadline?: string) => ({ title, deadline });

describe("the day an item is due", () => {
  it("is its deadline, else the date its name starts with, else none", () => {
    expect(dueDay(item("Offer", "2026-10-20"), NOW)).toBe("2026-10-20");
    expect(dueDay(item("1009 Offer"), NOW)).toBe("2026-10-09");
    expect(dueDay(item("Offer"), NOW)).toBeUndefined();
  });
});
