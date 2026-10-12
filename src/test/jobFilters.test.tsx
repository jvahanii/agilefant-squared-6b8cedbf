/**
 * The job-ad filters of a public page.
 *
 * Made for one kind of list — imported job ads, named "Employer - Role
 * (cities)" — and switched on per link, so most public pages never show them.
 * Pinned here: what each chip keeps, read from the role and not from the
 * employer or the cities; which chips a page opens with; where a job counts
 * as found; and that the panel is on the page only where the link has it.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { MemoryRouter, Route, Routes } from "react-router-dom";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({
  supabase: { rpc: (...args: unknown[]) => rpc(...args) },
}));

import PublicBacklog from "@/pages/PublicBacklog";
import {
  JOB_CHIPS,
  looksFinnish,
  passesChip,
  passesJobFilters,
  roleOf,
  sourceCounts,
  sourceOf,
  startingChips,
  type JobChip,
} from "@/lib/jobFilters";
import type { PublishedItem, PublishedPayload } from "@/lib/publicBacklog";

// Monday 12 October 2026, at noon.
const NOW = new Date(2026, 9, 12, 12);
const job = (title: string, extra: { deadline?: string; createdOn?: string; url?: string } = {}) => ({
  title,
  deadline: extra.deadline ?? null,
  createdOn: extra.createdOn ?? null,
  links: extra.url ? [{ url: extra.url }] : [],
});

describe("the role a job's name states", () => {
  it("is what follows the employer, less the cities at the end", () => {
    expect(roleOf("Fortum - Senior Analyst (Espoo)")).toBe("Senior Analyst");
    expect(roleOf("Botdot Oy - Senior Backend Engineer (Helsinki, Kaarina +1)")).toBe("Senior Backend Engineer");
    expect(roleOf("HUS – Ohjelmistoasiantuntija taloushallinto")).toBe("Ohjelmistoasiantuntija taloushallinto");
  });

  it("keeps a dash that is part of the role, and is the whole name where no employer leads it", () => {
    expect(roleOf("Mehiläinen - Senior Product Manager - BeeHealthy (Helsinki)")).toBe("Senior Product Manager - BeeHealthy");
    expect(roleOf("SearchAPI eng manager")).toBe("SearchAPI eng manager");
    // A hyphen inside a word is not the dash between employer and role.
    expect(roleOf("Full-stack developer")).toBe("Full-stack developer");
  });
});

describe("a role named in Finnish", () => {
  it("is known by its letters, its words and the way its words are built", () => {
    for (const role of [
      "Projektipäällikkö",
      "Ohjelmistoasiantuntija taloushallinto, Tietohallinto",
      "Ylitarkastaja",
      "Strategiajohtaja",
      "Rekrytointikonsultti",
      "Data-analyytikko (3 paikkaa)",
      "AWS arkkitehti",
      "Koneladontalinjan operaattori",
      "Turvallisuusvastaava",
      "Asiakasneuvoja / Advisor",
      "Yliaktuaari",
      "Mahdollisuuksia opiskelijoille",
      "Verkkotuottaja, osa-aikainen, Helsinki",
      "Scrum Master ja UX/UI-suunnittelija / palvelumuotoilija",
    ]) {
      expect(looksFinnish(role), role).toBe(true);
    }
  });

  it("is not read into an English role — by an employer's name in it, a Finnish city, or an English word with a Finnish-looking ending", () => {
    for (const role of [
      "Senior Dynamics Consultant – Tieto Tech Consulting (m/f/d)",
      "IT Project Manager (Swedish-speaking), Matrix42, Espoo, Kuopio, Tukholma, Oulu",
      "Data Analytics Engineer, Uusimaa",
      "Head of Talent Attraction and Acquisition",
      "Software Developer II",
      "Chemistry Laboratory Specialist",
      "Sustainability and Quality Coordinator",
      "Customer Success Manager",
      "Security Engineer",
      "Senior Accountant",
      "",
    ]) {
      expect(looksFinnish(role), role).toBe(false);
    }
  });
});

describe("what each chip keeps", () => {
  const keeps = (chip: JobChip, title: string) => passesChip(chip, job(title), NOW);

  it("leaves out by the role, not by the employer or the cities", () => {
    expect(keeps("noSenior", "Fortum - Senior Analyst (Espoo)")).toBe(false);
    expect(keeps("noSenior", "Fortum - Sr. Analyst")).toBe(false);
    expect(keeps("noSenior", "Senior Living Oy - Analyst")).toBe(true);
    expect(keeps("noStaff", "Wolt - Staff Engineer")).toBe(false);
    expect(keeps("noStaff", "Staffgate - Engineer (Staffanstorp)")).toBe(true);
    expect(keeps("noManager", "KONE - Senior Manager, Organizational Development")).toBe(false);
    expect(keeps("noManager", "Kesko - Projektipäällikkö")).toBe(false);
    expect(keeps("noManager", "Kesko - Analyst")).toBe(true);
    expect(keeps("noFinnish", "HUS - Ohjelmistoasiantuntija (Helsinki)")).toBe(false);
    expect(keeps("noFinnish", "Asianajotoimisto Krogerus - Legal Counsel (Helsinki)")).toBe(true);
  });

  it("narrows to a kind of job", () => {
    expect(keeps("trainee", "Bird & Bird - Assistant Trainee")).toBe(true);
    expect(keeps("trainee", "Nokia - Summer Intern, R&D")).toBe(true);
    expect(keeps("trainee", "Elisa - Harjoittelija, viestintä")).toBe(true);
    expect(keeps("trainee", "International Paper - Analyst")).toBe(false);
    expect(keeps("developer", "Reaktor - AI Developer")).toBe(true);
    expect(keeps("developer", "Vincit - Ohjelmistokehittäjä")).toBe(true);
    expect(keeps("developer", "Wolt - Software Engineer, Payments")).toBe(true);
    // A business developer develops business, not software.
    expect(keeps("developer", "Fortum - Business Developer Lead")).toBe(false);
    expect(keeps("developer", "Kela - Liiketoiminnan kehittäjä")).toBe(false);
    expect(keeps("developer", "Fortum - Analyst")).toBe(false);
  });

  it("counts a job as new for today and the six days before", () => {
    const made = (createdOn?: string) => passesChip("newThisWeek", job("X - Y", { createdOn }), NOW);
    expect(made("2026-10-12")).toBe(true);
    expect(made("2026-10-06")).toBe(true);
    expect(made("2026-10-05")).toBe(false);
    // A day never recorded cannot be shown to be new.
    expect(made(undefined)).toBe(false);
  });

  it("counts a job as expired only once its deadline has gone by", () => {
    const due = (deadline?: string) => passesChip("notExpired", job("X - Y", { deadline }), NOW);
    expect(due("2026-10-11")).toBe(false);
    // The day itself is still open, and no deadline is not an expired one.
    expect(due("2026-10-12")).toBe(true);
    expect(due(undefined)).toBe(true);
  });
});

describe("where a job was found", () => {
  it("is the site of its first link", () => {
    expect(sourceOf(job("X - Y", { url: "https://www.linkedin.com/jobs/view/1" }))).toBe("linkedin.com");
    expect(sourceOf(job("X - Y", { url: "https://fi.indeed.com/viewjob?jk=abc" }))).toBe("fi.indeed.com");
    expect(sourceOf(job("X - Y"))).toBeNull();
    expect(sourceOf(job("X - Y", { url: "not a link" }))).toBeNull();
  });

  const JOBS = [
    job("A - Analyst", { url: "https://duunitori.fi/tyopaikat/tyo/a" }),
    job("B - Senior Analyst", { url: "https://duunitori.fi/tyopaikat/tyo/b" }),
    job("C - Developer", { url: "https://www.jobly.fi/tyopaikka/c" }),
    job("D - Designer", { url: "https://www.jobly.fi/tyopaikka/d" }),
    job("E - Designer", { url: "https://www.jobly.fi/tyopaikka/e" }),
    job("F - Analyst"),
  ];

  it("is counted over what the chips leave, most jobs first", () => {
    expect(sourceCounts(JOBS, new Set(), NOW)).toEqual([
      { source: "jobly.fi", count: 3 },
      { source: "duunitori.fi", count: 2 },
    ]);
    expect(sourceCounts(JOBS, new Set<JobChip>(["noSenior"]), NOW)).toEqual([
      { source: "jobly.fi", count: 3 },
      { source: "duunitori.fi", count: 1 },
    ]);
  });

  it("narrows to the sources ticked — any one of them — on top of the chips", () => {
    const left = (chips: JobChip[], sources: string[]) =>
      JOBS.filter((j) => passesJobFilters(j, new Set(chips), new Set(sources), NOW)).map((j) => j.title[0]);
    expect(left([], [])).toEqual(["A", "B", "C", "D", "E", "F"]);
    expect(left([], ["duunitori.fi"])).toEqual(["A", "B"]);
    expect(left(["noSenior"], ["duunitori.fi"])).toEqual(["A"]);
    expect(left([], ["duunitori.fi", "jobly.fi"])).toEqual(["A", "B", "C", "D", "E"]);
  });
});

describe("the chips a page opens with", () => {
  it("are the ones that leave things out; the ones that narrow to a kind start off", () => {
    expect([...startingChips()]).toEqual(["noFinnish", "noSenior", "noStaff", "noManager", "notExpired"]);
    expect(JOB_CHIPS.map((c) => c.label)).toEqual([
      "No Finnish", "No senior", "No staff", "No manager", "Trainee", "Developer", "New this week", "Not expired",
    ]);
  });
});

describe("on the public page", () => {
  const item = (title: string, rank: number, extra: Partial<PublishedItem> = {}): PublishedItem => ({
    id: title, title, description: null, points: null, rating: null, status: null, parentId: null,
    backlogId: "b", rank, teamIds: [], labelIds: [], links: [], minutes: 0, totalMinutes: 0, ...extra,
  });
  const link = (url: string) => ({ links: [{ url, altText: null }] });
  const ITEMS = [
    item("Reaktor - AI Developer (Helsinki)", 1, link("https://www.reaktor.com/careers/ai-developer")),
    item("Fortum - Senior Analyst (Espoo)", 2, link("https://www.linkedin.com/jobs/view/2")),
    item("HUS - Ohjelmistoasiantuntija (Helsinki)", 3, link("https://duunitori.fi/tyopaikat/tyo/3")),
    item("KONE - Project Manager (Espoo)", 4, link("https://www.linkedin.com/jobs/view/4")),
    item("Wolt - Data Analyst (Helsinki)", 5, { ...link("https://www.linkedin.com/jobs/view/5"), deadline: "2020-01-01" }),
    item("Nokia - Designer (Espoo)", 6, link("https://duunitori.fi/tyopaikat/tyo/6")),
  ];
  const payload = (): PublishedPayload =>
    ({
      kind: "backlog", tree: { id: "t", name: "Jobs" }, rootBacklogId: "b",
      pointsVisible: false, ratingsVisible: false, timeVisible: false, labelsVisible: false, descriptionVisible: false,
      statusVisible: false, teamsVisible: false, linksVisible: true, deadlinesVisible: true, createdDatesVisible: true,
      treeMinutes: 0, backlogs: [{ id: "b", name: "Open jobs", parentId: null, rank: 0, labelIds: [], minutes: 0 }],
      statusesByBacklog: {}, teams: [], labels: [], items: ITEMS,
    }) as PublishedPayload;

  const open = (jobFilters: boolean | null) => {
    rpc.mockImplementation((name: string) =>
      name === "get_published_link_features"
        ? Promise.resolve({ data: jobFilters === null ? null : { jobFilters }, error: null })
        : Promise.resolve({ data: payload(), error: null }),
    );
    render(
      <MemoryRouter initialEntries={["/p/a-token-long-enough-to-be-one"]}>
        <Routes>
          <Route path="/p/:token" element={<PublicBacklog />} />
        </Routes>
      </MemoryRouter>,
    );
  };
  const panel = () => screen.getByRole("complementary", { name: "Filters" });
  const titles = () => ITEMS.map((i) => i.title).filter((t) => screen.queryByText(t));

  beforeEach(() => rpc.mockReset());

  it("has no filters where the link does not have them — which is every link but the ones they are switched on for", async () => {
    open(false);
    await screen.findByText("Fortum - Senior Analyst (Espoo)");
    expect(screen.queryByRole("complementary", { name: "Filters" })).not.toBeInTheDocument();
    expect(titles()).toHaveLength(6);
  });

  it("is the plain page too when the question about filters goes unanswered", async () => {
    open(null);
    await screen.findByText("Fortum - Senior Analyst (Espoo)");
    expect(screen.queryByRole("complementary", { name: "Filters" })).not.toBeInTheDocument();
  });

  it("opens with the leaving-out chips on, and says how many jobs that leaves", async () => {
    open(true);
    await screen.findByText("Reaktor - AI Developer (Helsinki)");
    // Senior, Finnish-titled, manager and expired are out.
    expect(titles()).toEqual(["Reaktor - AI Developer (Helsinki)", "Nokia - Designer (Espoo)"]);
    expect(within(panel()).getByRole("status")).toHaveTextContent("2 of 6 jobs");
    const pressed = (label: string) => within(panel()).getByRole("button", { name: label }).getAttribute("aria-pressed");
    expect(["No Finnish", "No senior", "No staff", "No manager", "Not expired"].map(pressed)).toEqual(Array(5).fill("true"));
    expect(["Trainee", "Developer", "New this week"].map(pressed)).toEqual(Array(3).fill("false"));
  });

  it("brings a kind of job back when its chip is switched off, and narrows to one when that chip is switched on", async () => {
    open(true);
    await screen.findByText("Reaktor - AI Developer (Helsinki)");
    fireEvent.click(within(panel()).getByRole("button", { name: "No senior" }));
    expect(titles()).toContain("Fortum - Senior Analyst (Espoo)");
    expect(within(panel()).getByRole("status")).toHaveTextContent("3 of 6 jobs");

    fireEvent.click(within(panel()).getByRole("button", { name: "Developer" }));
    expect(titles()).toEqual(["Reaktor - AI Developer (Helsinki)"]);
  });

  it("lists where the remaining jobs were found, with counts, and narrows to the ones ticked", async () => {
    open(true);
    await screen.findByText("Reaktor - AI Developer (Helsinki)");
    // Of the two jobs left: one from each.
    expect(within(panel()).getByLabelText(/duunitori\.fi/)).not.toBeChecked();
    expect(within(panel()).queryByLabelText(/linkedin\.com/)).not.toBeInTheDocument();

    fireEvent.click(within(panel()).getByRole("button", { name: "No senior" }));
    fireEvent.click(within(panel()).getByLabelText(/linkedin\.com/));
    expect(titles()).toEqual(["Fortum - Senior Analyst (Espoo)"]);
    expect(within(panel()).getByRole("status")).toHaveTextContent("1 of 6 jobs");
    // The other source is still offered, with what ticking it would add.
    expect(within(panel()).getByLabelText(/duunitori\.fi/)).toBeInTheDocument();
  });

  it("goes back to how it opened", async () => {
    open(true);
    await screen.findByText("Reaktor - AI Developer (Helsinki)");
    expect(within(panel()).queryByRole("button", { name: "Reset" })).not.toBeInTheDocument();
    fireEvent.click(within(panel()).getByRole("button", { name: "No Finnish" }));
    expect(titles()).toContain("HUS - Ohjelmistoasiantuntija (Helsinki)");
    fireEvent.click(within(panel()).getByRole("button", { name: "Reset" }));
    expect(titles()).toEqual(["Reaktor - AI Developer (Helsinki)", "Nokia - Designer (Espoo)"]);
  });

  it("says so when nothing is left, and filters by word within what the chips leave", async () => {
    open(true);
    await screen.findByText("Reaktor - AI Developer (Helsinki)");
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "analyst" } });
    // The analysts are senior or expired: none of the chips' two is one.
    expect(titles()).toEqual([]);
    fireEvent.change(screen.getByLabelText("Filter rows"), { target: { value: "" } });
    fireEvent.click(within(panel()).getByRole("button", { name: "Trainee" }));
    expect(screen.getByText("No jobs match these filters.")).toBeInTheDocument();
    expect(within(panel()).getByRole("status")).toHaveTextContent("0 of 6 jobs");
  });
});
