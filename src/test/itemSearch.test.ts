/**
 * What the search box finds, and in what order (itemSearch.ts).
 */
import { describe, it, expect } from "vitest";
import {
  commandBeingTyped,
  fold,
  matchItem,
  matchName,
  parseQuery,
  suggestCommands,
  type SearchContext,
} from "@/lib/itemSearch";
import type { WorkItemStatus } from "@/types/models";

// Midday on Friday 9 October 2026, local time.
const NOW = new Date(2026, 9, 9, 12);

let n = 0;
const item = (title: string, extra: { status?: WorkItemStatus; deadline?: string; description?: string; rating?: number; id?: string } = {}) => ({
  id: extra.id ?? `wi-${++n}`,
  title,
  status: extra.status ?? ("not_started" as WorkItemStatus),
  deadline: extra.deadline,
  description: extra.description,
  rating: extra.rating,
});

const finds = (query: string, it: ReturnType<typeof item>, ctx: SearchContext = {}) =>
  matchItem(it, parseQuery(query, NOW), ctx) !== null;

/** Titles in the order the search puts them. */
function ranked(query: string, items: ReturnType<typeof item>[], ctx: SearchContext = {}) {
  const parsed = parseQuery(query, NOW);
  return items
    .map((i) => ({ i, m: matchItem(i, parsed, ctx) }))
    .filter((r) => r.m)
    .sort((a, b) => b.m!.score - a.m!.score || a.i.title.localeCompare(b.i.title))
    .map((r) => r.i.title);
}

describe("words", () => {
  it("are found in any order", () => {
    expect(finds("jira release", item("Release notes for Jira"))).toBe(true);
    expect(finds("jira release", item("Release notes"))).toBe(false);
  });

  it("are found whatever the capitals and accents", () => {
    expect(finds("tyopaikka", item("Uusi työpaikka"))).toBe(true);
    expect(finds("TYÖPAIKKA", item("uusi tyopaikka"))).toBe(true);
    expect(finds("cafe", item("Café meeting"))).toBe(true);
  });

  it("are found with a letter wrong, missing, extra or swapped, from four letters on", () => {
    expect(finds("recieve", item("Receive the parcel"))).toBe(true);
    expect(finds("recive", item("Receive the parcel"))).toBe(true);
    expect(finds("receiive", item("Receive the parcel"))).toBe(true);
    expect(finds("budjet", item("Budget review"))).toBe(true);
    // Too short to guess at.
    expect(finds("cst", item("cat"))).toBe(false);
    // Too far off.
    expect(finds("parcel", item("Party planning"))).toBe(false);
  });

  it("are found at the start of a longer word with a letter wrong", () => {
    expect(finds("recieve", item("Receiver repairs"))).toBe(true);
  });

  it("are found in the description, a label, the Jira key or a link, and say where", () => {
    const withDescription = item("Weekly sync", { description: "<p>Agree on the <b>roadmap</b> for Q1</p>" });
    const m = matchItem(withDescription, parseQuery("roadmap", NOW))!;
    expect(m.elsewhere).toEqual([{ in: "description", snippet: "Agree on the roadmap for Q1" }]);

    const ctx: SearchContext = {
      jiraKey: (id) => (id === "k" ? "AF-20" : undefined),
      labelNames: (id) => (id === "l" ? ["Urgent"] : []),
      links: (id) => (id === "h" ? [{ url: "https://example.com/specs", altText: "Specification" }] : []),
    };
    expect(matchItem(item("Anything", { id: "k" }), parseQuery("af-20", NOW), ctx)!.elsewhere[0].in).toBe("key");
    expect(matchItem(item("Anything", { id: "l" }), parseQuery("urgent", NOW), ctx)!.elsewhere[0].in).toBe("label");
    expect(matchItem(item("Anything", { id: "h" }), parseQuery("specification", NOW), ctx)!.elsewhere[0]).toEqual({
      in: "link",
      snippet: "Specification",
    });
  });

  it("must all be found, wherever each is", () => {
    const withDescription = item("Weekly sync", { description: "Roadmap" });
    expect(finds("weekly roadmap", withDescription)).toBe(true);
    expect(finds("weekly budget", withDescription)).toBe(false);
  });

  it("mark where they are in the name", () => {
    const m = matchItem(item("Release notes for Jira"), parseQuery("jira notes", NOW))!;
    expect(m.ranges).toEqual([[18, 22], [8, 13]]);
  });
});

describe("the order", () => {
  it("puts the name as typed first, then names starting with it, then the rest", () => {
    const items = [
      item("A plan for the budget"),
      item("Budget plan for next year"),
      item("Budget plan"),
      item("Plans", { description: "budget" }),
    ];
    expect(ranked("budget plan", items)).toEqual([
      "Budget plan",
      "Budget plan for next year",
      "A plan for the budget",
      "Plans",
    ]);
  });

  it("puts open items before done ones that match as well", () => {
    expect(ranked("report", [item("Report", { status: "done" }), item("Report ", { status: "in_progress" })])).toEqual([
      "Report ",
      "Report",
    ]);
  });

  it("puts an exact match above a near one", () => {
    expect(ranked("receive", [item("Recieve"), item("Receive")])).toEqual(["Receive", "Recieve"]);
  });
});

describe("commands", () => {
  it("/due today finds what is due today, by deadline or by the date a name starts with", () => {
    expect(finds("/due today", item("Send the offer", { deadline: "2026-10-09" }))).toBe(true);
    expect(finds("/due today", item("Tomorrow's", { deadline: "2026-10-10" }))).toBe(false);
    expect(finds("/due today", item("1009 Fennia - Product owner"))).toBe(true);
    expect(finds("/due today", item("No deadline"))).toBe(false);
  });

  it("/due this week finds Monday to Sunday", () => {
    expect(finds("/due this week", item("Mon", { deadline: "2026-10-05" }))).toBe(true);
    expect(finds("/due this week", item("Sun", { deadline: "2026-10-11" }))).toBe(true);
    expect(finds("/due this week", item("Next Mon", { deadline: "2026-10-12" }))).toBe(false);
    expect(finds("/due this week", item("Last Sun", { deadline: "2026-10-04" }))).toBe(false);
  });

  it("/overdue finds what is past its deadline and not done", () => {
    expect(finds("/overdue", item("Late", { deadline: "2026-10-08" }))).toBe(true);
    expect(finds("/overdue", item("Late but done", { deadline: "2026-10-08", status: "done" }))).toBe(false);
    expect(finds("/overdue", item("Today", { deadline: "2026-10-09" }))).toBe(false);
  });

  it("/open and /done go by status", () => {
    expect(finds("/open", item("x", { status: "blocked" }))).toBe(true);
    expect(finds("/open", item("x", { status: "done" }))).toBe(false);
    expect(finds("/done", item("x", { status: "done" }))).toBe(true);
  });

  it("/label and /team go by the start of the name, quoted for spaces", () => {
    const ctx: SearchContext = { labelNames: () => ["Very urgent"], teamNames: () => ["Design"] };
    expect(finds("/label very", item("x"), ctx)).toBe(true);
    expect(finds('/label "very urgent"', item("x"), ctx)).toBe(true);
    expect(finds("/label urgent", item("x"), ctx)).toBe(false);
    expect(finds("/team des", item("x"), ctx)).toBe(true);
    expect(finds("/team ops", item("x"), ctx)).toBe(false);
  });

  it("/rated finds a rating, or a rating and above", () => {
    expect(finds("/rated 4+", item("x", { rating: 5 }))).toBe(true);
    expect(finds("/rated 4+", item("x", { rating: 3 }))).toBe(false);
    expect(finds("/rated 4", item("x", { rating: 5 }))).toBe(false);
    expect(finds("/rated 4", item("x", { rating: 4 }))).toBe(true);
    expect(finds("/rated 4+", item("x"))).toBe(false);
  });

  it("/scrambled finds the items whose name is scrambled", () => {
    const ctx: SearchContext = { scrambled: new Set(["wi-s"]) };
    expect(finds("/Scrambled", item("SNORKMAIDEN", { id: "wi-s" }), ctx)).toBe(true);
    expect(finds("/scrambled", item("Snorkmaiden"), ctx)).toBe(false);
  });

  it("combine with each other and with words", () => {
    const ctx: SearchContext = { labelNames: () => ["Urgent"] };
    const it1 = item("Fix the API", { status: "in_progress" });
    expect(finds("/open /label urgent api", it1, ctx)).toBe(true);
    expect(finds("/done /label urgent api", it1, ctx)).toBe(false);
    expect(finds("/open api docs", it1, ctx)).toBe(false);
  });

  it("are recognised whatever the capitals and spacing", () => {
    for (const typed of ["/due today", "/Due Today", "  /due   today  ", "/DUE TODAY"]) {
      expect(parseQuery(typed, NOW).commands.map((c) => c.text), typed).toEqual(["/due today"]);
    }
  });

  it("not understood are set aside, not searched for", () => {
    for (const typed of ["/due", "/due tod", "/", "/nonsense"]) {
      const parsed = parseQuery(typed, NOW);
      expect(parsed.commands, typed).toEqual([]);
      expect(parsed.words, typed).toEqual([]);
      expect(parsed.active, typed).toBe(false);
    }
    expect(parseQuery("due today", NOW).commands).toEqual([]);
  });
});

describe("suggestions", () => {
  it("are offered while a command is being typed, and not once it is finished", () => {
    expect(commandBeingTyped("/")).toBe("/");
    expect(commandBeingTyped("api /du")).toBe("/du");
    expect(suggestCommands("/du").map((c) => c.usage)).toEqual(["/due today", "/due this week"]);
    expect(suggestCommands("/").length).toBeGreaterThan(5);
    expect(commandBeingTyped("/overdue")).toBeNull();
    expect(commandBeingTyped("api")).toBeNull();
  });
});

describe("lists", () => {
  it("are found by name the same way", () => {
    expect(matchName("Avoimet työpaikat", ["tyopaikat"])).not.toBeNull();
    expect(matchName("Open jobs", ["jobs", "open"])!.score).toBeGreaterThan(matchName("Jobs that are open now", ["jobs", "open"])!.score - 100);
    expect(matchName("Open jobs", ["closed"])).toBeNull();
  });
});

describe("folding", () => {
  it("keeps the text's length, so marks land on the right letters", () => {
    for (const text of ["Työpaikka", "Café", "ÅÄÖ", "naïve résumé", "plain"]) expect(fold(text)).toHaveLength(text.length);
  });
});
