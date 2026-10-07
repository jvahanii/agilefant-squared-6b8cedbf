/**
 * Telling that two job ads are the same job by their names.
 *
 * The import knows a posting by its link, and the same job has several: one on
 * each board that carries it, and a new one each time a board re-posts it. A
 * check of the job lists found 38 jobs held twice or three times that way. The
 * cases below are those — the names as they stood in the lists.
 *
 * Pinned here: what counts as the same name, that a different city tells two
 * same-named ads apart, what the tree is asked, and what the picker says.
 */
import { describe, it, expect } from "vitest";
import {
  citiesApart,
  itemNameKeys,
  lookalikesFor,
  looksLikeSameJob,
  nameKey,
  nameParts,
  rememberName,
  type NamesInTree,
} from "../../supabase/functions/_shared/jobNames";
import { postingsInTree } from "../../supabase/functions/_shared/gmailImport";
import { lookalikeInTree, sameJobRows, startingReason, uncheckedReason, type PreviewLink } from "@/lib/gmailPreview";

describe("a name, as it is compared", () => {
  it("ignores case, punctuation and the kind of dash", () => {
    expect(nameKey("ICEYE - Staff Mechanical Design Engineer")).toBe(nameKey("Iceye – Staff  Mechanical Design Engineer"));
    expect(nameKey("Reaktor - Full Stack Developer")).toBe(nameKey("Reaktor - Full-Stack Developer"));
  });

  it("ignores the closing date an older name starts with", () => {
    expect(nameKey("0930 Fennia - Product owner")).toBe(nameKey("Fennia - Product owner"));
    // Four digits that are part of the name stay.
    expect(nameKey("Fennia - Vision 2030")).toBe("fennia vision 2030");
  });

  it("splits an item's name from the cities it ends in", () => {
    expect(nameParts("Fortum - Analyst (Espoo, Helsinki)")).toEqual({
      key: "fortum analyst espoo helsinki",
      bareKey: "fortum analyst",
      places: ["espoo", "helsinki"],
    });
    // "+3" means more cities than it names: nothing can be said about which.
    expect(nameParts("DNA - Senior Solution Consultant, B2B (Helsinki, Oulu +3)").places).toBeNull();
    expect(nameParts("Fintraffic - Tuotepäällikkö")).toEqual({ key: "fintraffic tuotepäällikkö", bareKey: null, places: null });
  });

  it("finds an item under its whole name and under the name without its cities", () => {
    expect(itemNameKeys("Smartly - Senior Software Engineer (AI Platform) (Helsinki)")).toEqual([
      "smartly senior software engineer ai platform helsinki",
      "smartly senior software engineer ai platform",
    ]);
  });
});

describe("the same job, or not", () => {
  it("is the same job from another board", () => {
    const inTree = "Kesko - Manager, Application Management Services K-ryhmään (Helsinki)";
    expect(looksLikeSameJob({ title: "Kesko - Manager, Application Management Services K-ryhmään" }, inTree)).toBe(true);
    expect(
      looksLikeSameJob({ title: "Kesko - Manager, Application Management Services K-ryhmään", cities: ["Helsinki"] }, inTree),
    ).toBe(true);
  });

  it("is the same job when the name already carries what the item's ends in", () => {
    // "(100 % etätyö)" is part of the role, not a city.
    const name = "LAVI AI Oy - Account Executive / Myyntipäällikkö (100 % etätyö)";
    expect(looksLikeSameJob({ title: name, cities: ["Helsinki"] }, name)).toBe(true);
  });

  it("is a different job when it is somewhere else entirely", () => {
    const espoo = "Basware - Portfolio Architect (Espoo)";
    expect(looksLikeSameJob({ title: "Basware - Portfolio Architect", cities: ["Pori"] }, espoo)).toBe(false);
    expect(looksLikeSameJob({ title: "Basware - Portfolio Architect", cities: ["Espoo", "Pori"] }, espoo)).toBe(true);
  });

  it("is taken for the same job while its city is not known yet", () => {
    expect(looksLikeSameJob({ title: "Basware - Portfolio Architect" }, "Basware - Portfolio Architect (Espoo)")).toBe(true);
    expect(looksLikeSameJob({ title: "Basware - Portfolio Architect", cities: [] }, "Basware - Portfolio Architect (Espoo)")).toBe(true);
  });

  it("cannot be told apart by city from an item in more cities than it names", () => {
    const many = "Lokki Henkilöstöpalvelut Oy - AI Full Stack Developer (Kangasala, Nokia +8)";
    expect(looksLikeSameJob({ title: "Lokki Henkilöstöpalvelut Oy - AI Full Stack Developer", cities: ["Tampere"] }, many)).toBe(true);
  });

  it("is not the same job for a different role, or a name too short to go by", () => {
    expect(looksLikeSameJob({ title: "Reaktor - Lead Developer" }, "Reaktor - Full Stack Developer (Helsinki)")).toBe(false);
    expect(looksLikeSameJob({ title: "CTO" }, "CTO")).toBe(false);
  });

  it("knows when two lists of cities have nothing in common", () => {
    expect(citiesApart(["Espoo"], ["Tampere"])).toBe(true);
    expect(citiesApart(["Espoo", "Helsinki"], ["helsinki"])).toBe(false);
    // Unknown, or read and none named: not apart.
    expect(citiesApart(undefined, ["Tampere"])).toBe(false);
    expect(citiesApart([], ["Tampere"])).toBe(false);
  });
});

describe("what the tree is asked", () => {
  const names: NamesInTree = new Map();
  rememberName(names, "Basware - Portfolio Architect (Espoo)", "Jobs with no deadline");
  rememberName(names, "Basware - Portfolio Architect (Pori)", "Jobs with no deadline");
  rememberName(names, "Fintraffic - Tuotepäällikkö (Helsinki)", "Jobs with deadline");

  it("offers every item a posting's name matches, with its list", () => {
    expect(lookalikesFor(names, "Basware - Portfolio Architect")).toEqual([
      { title: "Basware - Portfolio Architect (Espoo)", list: "Jobs with no deadline" },
      { title: "Basware - Portfolio Architect (Pori)", list: "Jobs with no deadline" },
    ]);
    expect(lookalikesFor(names, "FINTRAFFIC – Tuotepäällikkö")).toEqual([
      { title: "Fintraffic - Tuotepäällikkö (Helsinki)", list: "Jobs with deadline" },
    ]);
  });

  it("offers nothing for a name the tree does not hold", () => {
    expect(lookalikesFor(names, "Fintraffic - Tuoteomistaja")).toEqual([]);
    expect(lookalikesFor(names, "")).toEqual([]);
  });

  it("is read from the tree's items in the same pass as their links", async () => {
    const TREE = "org::bt-1";
    const items = [
      { id: "wi-1", title: "Kesko - Manager (Helsinki)", backlog_assignments: { [TREE]: "bl-dl" } },
      { id: "wi-2", title: "Elsewhere - Other", backlog_assignments: { "org::bt-2": "bl-x" } },
    ];
    const from = (table: string) => {
      let key: string | null = null;
      const self = {
        select: () => self,
        eq: () => self,
        in: () => self,
        order: () => self,
        range: () => self,
        not(column: string) {
          key = column.match(/^backlog_assignments->>"(.+)"$/)?.[1] ?? null;
          return self;
        },
        then(resolve: (v: unknown) => unknown) {
          const data =
            table === "work_items"
              ? items.filter((i) => (key ? (i.backlog_assignments as Record<string, string>)[key] : true))
              : table === "backlogs"
                ? [{ id: "bl-dl", name: "Jobs with deadline" }]
                : [{ work_item_id: "wi-1", url: "https://duunitori.fi/tyopaikat/tyo/manager-1" }];
          return Promise.resolve(resolve({ data, error: null }));
        },
      };
      return self;
    };

    const tree = await postingsInTree({ from }, "org", TREE);
    expect(tree.urls.get("https://duunitori.fi/tyopaikat/tyo/manager-1")).toBe("Jobs with deadline");
    expect(lookalikesFor(tree.names, "Kesko - Manager")).toEqual([{ title: "Kesko - Manager (Helsinki)", list: "Jobs with deadline" }]);
    expect(lookalikesFor(tree.names, "Elsewhere - Other")).toEqual([]);
  });
});

describe("what the picker says", () => {
  const row = (over: Partial<PreviewLink>): PreviewLink => ({
    url: "https://www.linkedin.com/jobs/view/1",
    title: "Kesko - Manager",
    messageId: "m-1",
    subject: "New jobs",
    from: "LinkedIn <jobalerts-noreply@linkedin.com>",
    date: "2026-10-07T08:00:00Z",
    alreadyImported: false,
    ...over,
  });
  const inTree = [{ title: "Kesko - Manager (Helsinki)", list: "Jobs with deadline" }];

  it("leaves a posting unticked that looks like an item already there, and names it", () => {
    expect(uncheckedReason(row({ lookalikes: inTree }))).toBe("looks like “Kesko - Manager (Helsinki)”, already in Jobs with deadline");
  });

  it("ticks it when it turns out to be in another city", () => {
    expect(uncheckedReason(row({ lookalikes: inTree, cities: ["Oulu"] }))).toBeNull();
    expect(lookalikeInTree(row({ lookalikes: inTree, cities: ["Helsinki", "Oulu"] }))).toEqual(inTree[0]);
  });

  it("goes on to the next candidate when the first is somewhere else", () => {
    const two = [
      { title: "Kesko - Manager (Helsinki)", list: "Jobs with deadline" },
      { title: "Kesko - Manager (Oulu)", list: "Jobs with no deadline" },
    ];
    expect(lookalikeInTree(row({ lookalikes: two, cities: ["Oulu"] }))).toEqual(two[1]);
  });

  it("says a reason of the posting's own first", () => {
    expect(uncheckedReason(row({ lookalikes: inTree, applicationsClosed: true }))).toBe("no longer accepting applications");
  });

  it("unticks the same job listed twice in one run under two links, keeping the dated copy", () => {
    const jobly = row({ url: "https://www.jobly.fi/tyopaikka/manager-1", messageId: "m-2", subject: "Jobly" });
    const duunitori = row({ url: "https://duunitori.fi/tyopaikat/tyo/manager-1", messageId: "m-3", deadline: "2026-10-11" });
    const reasons = sameJobRows([jobly, duunitori]);
    expect([...reasons.keys()]).toEqual(["m-2|https://www.jobly.fi/tyopaikka/manager-1"]);
    expect(startingReason(jobly, reasons)).toBe("same job as “Kesko - Manager” from duunitori.fi, listed here too");
    expect(startingReason(duunitori, reasons)).toBeNull();
  });

  it("keeps the first of them when neither is dated", () => {
    const first = row({ url: "https://thehub.io/jobs/1", title: "ICEYE - Staff Mechanical Design Engineer" });
    const second = row({ url: "https://duunitori.fi/tyopaikat/tyo/x-1", title: "Iceye - Staff Mechanical Design Engineer", messageId: "m-2" });
    expect([...sameJobRows([first, second]).keys()]).toEqual(["m-2|https://duunitori.fi/tyopaikat/tyo/x-1"]);
  });

  it("leaves both ticked when they are in different cities — one ad per city is as many jobs", () => {
    const helsinki = row({ url: "https://www.reaktor.com/careers/lead-developer", title: "Reaktor - Lead Developer", cities: ["Helsinki"] });
    const turku = row({ url: "https://www.reaktor.com/careers/lead-developer-turku", title: "Reaktor - Lead Developer", cities: ["Turku"] });
    const lisbon = row({ url: "https://www.reaktor.com/careers/lead-developer-lisbon", title: "Reaktor - Lead Developer", cities: ["Lisbon"] });
    expect(sameJobRows([helsinki, turku, lisbon]).size).toBe(0);
  });

  it("does not count one link carried by two emails as two jobs", () => {
    const a = row({});
    const b = row({ messageId: "m-2" });
    expect(sameJobRows([a, b]).size).toBe(0);
  });
});
