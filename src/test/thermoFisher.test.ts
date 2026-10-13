/**
 * Thermo Fisher Scientific's recruiting newsletter, and the list it stands for.
 *
 * The mail (13.10.2026, "Make an Impact Every Day—Apply to Join Thermo Fisher
 * Scientific", from opportunities@campaign.thermofisher.com) names no job: its
 * links are click trackers to worldwide searches by trade and to stories about
 * the company. So the import takes it as word that the company is hiring and
 * reads the company's own list of jobs open in Finland. The shapes below are
 * the mail's and the site's as they were that day, cut down.
 */
import { describe, it, expect, vi } from "vitest";
import { extractLinks, type GmailMessage } from "../../supabase/functions/_shared/extract";
import { filterJobLinks, jobSourceFor, defaultJobQuery, canonicalizeByHost } from "../../supabase/functions/_shared/jobSources";
import { expandListings, MAX_LISTING_PAGES } from "../../supabase/functions/_shared/jobListings";
import { phenomNextPage, phenomSearch, THERMO_FISHER_FINLAND } from "../../supabase/functions/_shared/phenom";
import { factsFromPage, structuredDescription } from "../../supabase/functions/_shared/fetchDeadline";

const FROM = "Thermo Fisher Scientific <opportunities@campaign.thermofisher.com>";
const LIST = "https://jobs.thermofisher.com/global/en/search-results?qcountry=Finland";
const tracker = (n: number) => `https://u12655194.ct.sendgrid.net/ls/click?upn=u001.${"x".repeat(40)}${n}`;

const MAIL = `<html><body>
  <p>Hi Jarno, Behind every breakthrough in healthcare are teams working to improve patient outcomes.</p>
  <table><tr><td><a style='display:inline-block' href='${tracker(1)}' target='_blank'><span>Explore Engineering Jobs</span></a></td></tr></table>
  <table><tr><td><a href='${tracker(2)}' target='_blank'><span>Read Gideon's Story</span></a></td></tr></table>
  <p>View All Open Opportunities. Explore openings:</p>
  <a href="${tracker(3)}">Field Service Engineers</a>
  <a href="${tracker(4)}">Software Engineers</a>
  <a href="${tracker(5)}">Project Managers</a>
  <a href="${tracker(6)}">Read Our Privacy Policy</a>
</body></html>`;

const b64 = (s: string) => Buffer.from(s, "utf8").toString("base64").replace(/\+/g, "-").replace(/\//g, "_");
const message = (html: string, from = FROM, id = "1a132452d21ed996"): GmailMessage =>
  ({
    id,
    internalDate: String(Date.UTC(2026, 9, 12, 22, 39)),
    payload: {
      mimeType: "text/html",
      headers: [
        { name: "Subject", value: "Make an Impact Every Day—Apply to Join Thermo Fisher Scientific" },
        { name: "From", value: from },
      ],
      body: { data: b64(html) },
    },
  }) as GmailMessage;

const job = (title: string, jobId: string, multi_location: string[]) => ({
  title,
  jobId,
  jobSeqNo: `TFSCGLOBAL${jobId.replace(/-/g, "")}EXTERNALENGLOBAL`,
  city: "",
  country: "Finland",
  location: multi_location[0],
  multi_location,
  applyUrl: `https://thermofisher.wd5.myworkdayjobs.com/ThermoFisherCareers/job/x/${jobId}/apply`,
});
/** A search page as the site serves it: the list is data in a script. */
const page = (jobs: unknown[], totalHits = jobs.length) =>
  `<!DOCTYPE html><html><head><title></title><script type="text/javascript">/*<!--*/ var phApp = phApp || {"widgetApiEndpoint":"https://jobs.thermofisher.com/widgets"}; phApp.ddo = ${JSON.stringify(
    { siteConfig: { status: "success" }, eagerLoadRefineSearch: { status: 200, hits: jobs.length, totalHits, data: { jobs } } },
  )}; phApp.experimentData = {}; /*-->*/</script></head><body><div class="ph-page"></div></body></html>`;

const FINLAND = page([
  job("Business Analyst", "R-01369408", ["Finland"]),
  job("Warehouse Worker", "R-01369407", ["Finland"]),
  job("Senior Director, Regional Marketing, Life Sciences EMEA", "R-01366320", [
    "Paisley, Renfrewshire, United Kingdom",
    "Oslo, Norway",
    "Finland",
    "Stockholm, Sweden",
  ]),
  job("Field Application Scientist", "R-01370001", ["Vantaa, Finland", "Remote, Sweden"]),
]);

describe("the newsletter by itself", () => {
  it("is a sender the import knows, and one a new search looks for", () => {
    expect(jobSourceFor(FROM)?.id).toBe("thermofisher");
    expect(defaultJobQuery()).toContain("opportunities@campaign.thermofisher.com");
  });

  it("names no job, so the whole mail comes down to one link: the company's list of jobs in Finland", () => {
    const links = extractLinks(message(MAIL), "jobs");
    expect(links).toHaveLength(1);
    expect(links[0]).toMatchObject({ url: LIST, messageId: "1a132452d21ed996", from: FROM });
  });

  it("still reads a job it does name, as a job", () => {
    const direct = "https://jobs.thermofisher.com/global/en/job/R-01369408/Business-Analyst?utm_source=phenom&utm_medium=email";
    const links = filterJobLinks(FROM, [{ url: tracker(1) }, { url: direct, title: "Business Analyst" }]);
    // The id is the job; the title after it is decoration.
    expect(links.map((l) => l.url)).toEqual(["https://jobs.thermofisher.com/global/en/job/R-01369408"]);
    expect(canonicalizeByHost(direct)).toBe("https://jobs.thermofisher.com/global/en/job/R-01369408");
  });

  it("is nothing at all when it has no link in it", () => {
    expect(filterJobLinks(FROM, [])).toEqual([]);
  });
});

describe("the list the mail stands for", () => {
  it("is in the page as served, as the data its script starts from", () => {
    const search = phenomSearch(FINLAND);
    expect(search?.totalHits).toBe(4);
    expect(search?.jobs[0]).toEqual({ title: "Business Analyst", jobId: "R-01369408", locations: ["Finland"] });
    expect(phenomSearch("<html><body>Just a moment...</body></html>")).toBeNull();
    expect(phenomSearch("<script>phApp.ddo = {not json}; phApp.x = 1;</script>")).toBeNull();
  });

  it("gives each job its address by id, and a city only where the list names one in Finland", () => {
    expect(THERMO_FISHER_FINLAND.positions(FINLAND, LIST)).toEqual([
      { url: "https://jobs.thermofisher.com/global/en/job/R-01369408", title: "Business Analyst", cities: [] },
      { url: "https://jobs.thermofisher.com/global/en/job/R-01369407", title: "Warehouse Worker", cities: [] },
      // Offered across Europe: none of those cities is where it is in Finland.
      {
        url: "https://jobs.thermofisher.com/global/en/job/R-01366320",
        title: "Senior Director, Regional Marketing, Life Sciences EMEA",
        cities: [],
      },
      { url: "https://jobs.thermofisher.com/global/en/job/R-01370001", title: "Field Application Scientist", cities: ["Vantaa"] },
    ]);
  });

  it("runs on to a next page only while there are more jobs than it has shown", () => {
    const ten = Array.from({ length: 10 }, (_, i) => job(`Job ${i}`, `R-${i}`, ["Finland"]));
    expect(phenomNextPage(page(ten, 23), LIST)).toBe(`${LIST}&from=10&s=1`);
    expect(phenomNextPage(page(ten, 23), `${LIST}&from=10&s=1`)).toBe(`${LIST}&from=20&s=1`);
    expect(phenomNextPage(page(ten.slice(0, 3), 23), `${LIST}&from=20&s=1`)).toBeNull();
    expect(phenomNextPage(FINLAND, LIST)).toBeNull();
  });
});

describe("the mail turned into the jobs on the list", () => {
  const fromMail = () => extractLinks(message(MAIL), "jobs");

  it("offers every job on the list, named after the employer, under the email it came by", async () => {
    const read = vi.fn(async () => FINLAND);
    const links = await expandListings(fromMail(), read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(read).toHaveBeenCalledWith(LIST);
    expect(links.map((l) => l.title)).toEqual([
      "Thermo Fisher Scientific - Business Analyst",
      "Thermo Fisher Scientific - Warehouse Worker",
      "Thermo Fisher Scientific - Senior Director, Regional Marketing, Life Sciences EMEA",
      "Thermo Fisher Scientific - Field Application Scientist",
    ]);
    // The email's id travels with each: it is what the picker groups by, and
    // what the import marks read.
    expect(new Set(links.map((l) => l.messageId))).toEqual(new Set(["1a132452d21ed996"]));
    expect(links[3]).toMatchObject({
      url: "https://jobs.thermofisher.com/global/en/job/R-01370001",
      company: "Thermo Fisher Scientific",
      cities: ["Vantaa"],
      from: FROM,
    });
  });

  it("reads a longer list page by page, each job once", async () => {
    const ten = Array.from({ length: 10 }, (_, i) => job(`Job ${i}`, `R-${i}`, ["Finland"]));
    const rest = [job("Job 9", "R-9", ["Finland"]), job("Job 10", "R-10", ["Finland"])];
    const read = vi.fn(async (url: string) => (url.includes("from=10") ? page(rest, 11) : page(ten, 11)));
    const links = await expandListings(fromMail(), read);
    expect(read.mock.calls.map(([url]) => url)).toEqual([LIST, `${LIST}&from=10&s=1`]);
    expect(links).toHaveLength(11);
  });

  it("stops at a few pages however long the list claims to be", async () => {
    const ten = (from: number) => Array.from({ length: 10 }, (_, i) => job(`Job ${from + i}`, `R-${from + i}`, ["Finland"]));
    const read = vi.fn(async (url: string) => page(ten(Number(new URL(url).searchParams.get("from") ?? 0)), 5000));
    const links = await expandListings(fromMail(), read);
    expect(read).toHaveBeenCalledTimes(MAX_LISTING_PAGES);
    expect(links).toHaveLength(MAX_LISTING_PAGES * 10);
  });

  it("reads the list once for two newsletters, and offers its jobs under each", async () => {
    const read = vi.fn(async () => FINLAND);
    const two = [...extractLinks(message(MAIL), "jobs"), ...extractLinks(message(MAIL, FROM, "1a0a21b233c29122"), "jobs")];
    const links = await expandListings(two, read);
    expect(read).toHaveBeenCalledTimes(1);
    expect(links.filter((l) => l.messageId === "1a0a21b233c29122")).toHaveLength(4);
    expect(links).toHaveLength(8);
  });

  it("offers nothing when the list will not come — a list of jobs is never offered as a job", async () => {
    expect(await expandListings(fromMail(), async () => null)).toEqual([]);
    // Nor when what came is not the list: a bot check, a redesign.
    expect(await expandListings(fromMail(), async () => "<html><body>Just a moment...</body></html>")).toEqual([]);
  });

  it("leaves every other sender's links exactly as they were, and asks for nothing", async () => {
    const read = vi.fn(async () => FINLAND);
    const others = [
      { url: "https://duunitori.fi/tyopaikat/tyo/ai-engineer-20567347", from: "duunivahti@duunitori.fi", title: "AI Engineer" },
      // The same address from someone who is not Thermo Fisher is just a link.
      { url: LIST, from: "A Friend <friend@example.com>", title: "have a look" },
    ];
    expect(await expandListings(others, read)).toBe(others);
    expect(read).not.toHaveBeenCalled();
  });
});

describe("a job's own page", () => {
  // The site draws the page with script: what a reader of its text gets is the
  // menus, and the ad is in schema.org data, its markup written as entities.
  const description =
    "&lt;p style=&quot;text-align:left&quot;&gt;&lt;b&gt;Work Schedule&lt;/b&gt;&lt;/p&gt;Standard (Mon-Fri)" +
    "&lt;p&gt;Our Vantaa site is one of Thermo Fisher Scientific&#39;s Centers of Excellence in Finland.&lt;/p&gt;" +
    "&lt;ul&gt;&lt;li&gt;Experience working with Agile methodologies and tools&lt;/li&gt;" +
    "&lt;li&gt;Fluent communication skills in Finnish and English, both written and spoken&lt;/li&gt;&lt;/ul&gt;";
  const jobPage = `<html><head><title></title>
    <script type="application/ld+json">{"@context":"http://schema.org","@type":"WebPage","name":"Business Analyst"}</script>
    <script type="application/ld+json">${JSON.stringify({
      "@context": "http://schema.org",
      "@type": "JobPosting",
      title: "Business Analyst",
      description,
      jobLocation: { "@type": "Place", address: { "@type": "PostalAddress", addressCountry: "Finland", addressLocality: "" } },
    })}</script></head><body><nav>Careers Search jobs Saved jobs Sign in</nav></body></html>`;

  it("has its ad read out of the structured data", () => {
    const text = structuredDescription(jobPage);
    expect(text).toContain("Fluent communication skills in Finnish and English, both written and spoken");
    expect(text).not.toMatch(/[<>]|&lt;/);
    expect(structuredDescription("<html><body>No data here</body></html>")).toBe("");
    expect(structuredDescription('<script type="application/ld+json">{broken</script>')).toBe("");
  });

  it("so that what the ad says about Finnish is known, though none of it is in the page's text", () => {
    const facts = factsFromPage("https://jobs.thermofisher.com/global/en/job/R-01369408", 200, "text/html", jobPage, "2026-10-13");
    expect(facts.language).toMatchObject({ finnish: "required", basis: "stated" });
    expect(facts.language?.evidence).toContain("Fluent communication skills in Finnish and English");
    expect(facts.closed).toBe(false);
  });
});
