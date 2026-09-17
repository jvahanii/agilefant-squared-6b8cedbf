/**
 * "Fill deadlines": giving job-ad items the MMDD prefix their import could not.
 * Jobly postings go through the browser; everything else through posting-status.
 */
import { describe, it, expect, vi } from "vitest";
import {
  findMissingDeadlines,
  isJobPostingUrl,
  itemsMissingDeadline,
  referenceDate,
  titleWithDeadline,
} from "@/lib/deadlineBackfill";
import { wellFormedDeadline } from "../../supabase/functions/_shared/deadlines";

const JOBLY = "https://www.jobly.fi/tyopaikka/senior-ai-solutions-engineer-2760006";
const LINKEDIN = "https://www.linkedin.com/jobs/view/4465791712";
const ARTICLE = "https://example.com/blog/deadline-driven-development";

describe("which items are filled", () => {
  it("takes job ads without a prefix, and leaves prefixed items and non-job links alone", () => {
    const items = [
      { id: "a", title: "Alma Media — Senior AI Solutions Engineer", urls: [JOBLY] },
      { id: "b", title: "1011 Alma Media — already has one", urls: [JOBLY] },
      { id: "c", title: "***** Nokia Head of Talent", urls: [LINKEDIN] },
      { id: "d", title: "Read later", urls: [ARTICLE] },
    ];
    expect(itemsMissingDeadline(items).map((i) => i.id)).toEqual(["a", "c"]);
  });

  it("recognises job postings by the importer's own board rules", () => {
    expect(isJobPostingUrl(JOBLY)).toBe(true);
    expect(isJobPostingUrl(LINKEDIN)).toBe(true);
    expect(isJobPostingUrl(ARTICLE)).toBe(false);
    expect(isJobPostingUrl("mailto:jan.tilles@almamedia.fi")).toBe(false);
  });
});

describe("titleWithDeadline", () => {
  it("puts MMDD in front", () => {
    expect(titleWithDeadline("Alma Media — Senior AI Solutions Engineer", "2026-10-11")).toBe(
      "1011 Alma Media — Senior AI Solutions Engineer",
    );
    expect(titleWithDeadline("***** Nokia", "2026-09-30")).toBe("0930 ***** Nokia");
  });
});

describe("referenceDate", () => {
  it("reads the import's Received line", () => {
    const description = "From email: Jobly\nSender: Jobly <noreply@jobly.fi>\nReceived: 2026-09-17T07:22:14.000Z\nLink: " + JOBLY;
    expect(referenceDate(description)).toBe("2026-09-17T07:22:14.000Z");
    expect(referenceDate("no such line")).toBeUndefined();
    expect(referenceDate(undefined)).toBeUndefined();
  });
});

describe("findMissingDeadlines", () => {
  const items = [
    { id: "jobly", title: "Alma Media — AI", urls: [JOBLY], description: "Received: 2026-09-17T07:22:14.000Z" },
    { id: "li-dated", title: "Elisa — Team Manager", urls: [LINKEDIN] },
    { id: "li-none", title: "Nordea — AI Platform Engineer", urls: ["https://www.linkedin.com/jobs/view/4465054408"] },
    { id: "li-refused", title: "Wolt — EM", urls: ["https://www.linkedin.com/jobs/view/4410807844"] },
  ];
  const serverFacts = vi.fn(async (urls: string[]) =>
    Object.fromEntries(
      urls.map((url) => [
        url,
        url === LINKEDIN
          ? { deadline: "2026-09-30", unreachable: null }
          : url.endsWith("4410807844")
            ? { deadline: null, unreachable: 999 }
            : { deadline: null, unreachable: null },
      ]),
    ),
  );
  const needsBrowser = (url: string) => url.includes("jobly.fi");

  it("reads Jobly through the browser and the rest through the server", async () => {
    const browserFacts = vi.fn(async () => ({ deadline: "2026-10-11", closed: false }));
    const progress: number[] = [];

    const result = await findMissingDeadlines(items, {
      serverFacts,
      needsBrowser,
      browserFacts,
      onProgress: (done) => progress.push(done),
    });

    expect([...result.found]).toEqual([
      ["li-dated", "2026-09-30"],
      ["jobly", "2026-10-11"],
    ]);
    expect(result.noneStated).toBe(1);
    expect(result.unreadable).toBe(1);
    expect(result.needsReader).toBe(0);
    // The server never sees the Jobly link; the browser gets the import's date as reference.
    expect(serverFacts.mock.calls.flat(2)).not.toContain(JOBLY);
    expect(browserFacts).toHaveBeenCalledWith(JOBLY, "2026-09-17T07:22:14.000Z");
    expect(progress).toEqual([1, 2, 3, 4]);
  });

  it("counts Jobly ads as needing the extension when it is not installed", async () => {
    const result = await findMissingDeadlines(items, { serverFacts, needsBrowser, browserFacts: null });
    expect(result.needsReader).toBe(1);
    expect(result.found.has("jobly")).toBe(false);
  });

  it("counts a failed posting-status call as unreadable rather than throwing", async () => {
    const result = await findMissingDeadlines(items.slice(1), {
      serverFacts: async () => {
        throw new Error("offline");
      },
      needsBrowser,
      browserFacts: null,
    });
    expect(result.unreadable).toBe(3);
    expect(result.found.size).toBe(0);
  });
});

describe("wellFormedDeadline", () => {
  it("lets through only a real yyyy-mm-dd date", () => {
    expect(wellFormedDeadline("2026-10-11")).toBe("2026-10-11");
    expect(wellFormedDeadline("2026-02-31")).toBeUndefined();
    expect(wellFormedDeadline("11.10.2026")).toBeUndefined();
    expect(wellFormedDeadline("2026-10-11; DROP TABLE")).toBeUndefined();
    expect(wellFormedDeadline(20261011)).toBeUndefined();
    expect(wellFormedDeadline(undefined)).toBeUndefined();
  });
});
