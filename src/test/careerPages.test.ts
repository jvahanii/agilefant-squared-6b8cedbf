/**
 * Company career pages, read by the job import beside the alert mail.
 *
 * Pinned here: which addresses are pages it can read, what it makes of one's
 * markup, how a page's positions travel as links, and what the import writes
 * about a posting that came from a page rather than an email.
 */
import { describe, it, expect } from "vitest";
import {
  careerPageAddress,
  careerPageFor,
  isPageMessageId,
  pageMessageId,
  pageUrlOf,
  positionsAsLinks,
} from "../../supabase/functions/_shared/careerPages";
import { importLinksAsWorkItems } from "../../supabase/functions/_shared/gmailImport";
import {
  careerPageLine,
  declineLabel,
  declinedSummary,
  emailCountOf,
  foundWhere,
  pageCountOf,
  previewSummary,
} from "@/lib/gmailPreview";

const REAKTOR = "https://www.reaktor.com/careers/all-open-positions";

/** Rows as Reaktor's page serves them, with the furniture around them. */
const REAKTOR_HTML = `
  <nav><a href="https://www.reaktor.com/careers">Careers</a>
  <a href="https://www.reaktor.com/careers/locations/helsinki">Helsinki</a></nav>
  <select data-location><option value="all-location">All</option></select>
  <div class="l-open-positions__listing" data-open-positions-listing>
    <ul>
      <li data-open-position-row data-position-location="Helsinki" data-position-category="">
        <a href="/careers/head-of-marketing" target="_blank" rel="noopener noreferrer">
          <div class="l-open-positions__item">
            <div class="title-wrap"><h3 class="h1"> Head of Marketing</h3></div>
            <div class="tags-wrap"><p class="location"> Helsinki </p><p class="category"></p></div>
          </div>
        </a>
      </li>
      <li data-open-position-row data-position-location="Helsinki, Turku" data-position-category="">
        <a href="/careers/head-of-communications" target="_blank" rel="noopener noreferrer">
          <div class="l-open-positions__item">
            <div class="title-wrap"><h3 class="h1">Head of Communications &amp; Investor Relations</h3></div>
          </div>
        </a>
      </li>
      <li data-open-position-row data-position-location="Tokyo" data-position-category="Technology">
        <a href="/ja-jp/careers/senior-technical-lead-tokyo?utm_source=careers" target="_blank">
          <div class="l-open-positions__item">
            <div class="title-wrap"><h3 class="h1">Senior Technical Lead</h3></div>
          </div>
        </a>
      </li>
      <li data-open-position-row data-position-location="Helsinki" data-position-category="">
        <a href="/careers/head-of-marketing"><h3>Head of Marketing</h3></a>
      </li>
    </ul>
  </div>
  <footer><a href="/careers/all-open-positions">All open positions</a></footer>`;

describe("which pages can be read", () => {
  it("knows Reaktor's open positions page, however it is written", () => {
    expect(careerPageFor(REAKTOR)?.company).toBe("Reaktor");
    expect(careerPageFor("https://reaktor.com/careers/all-open-positions/")?.company).toBe("Reaktor");
    expect(careerPageFor(`  ${REAKTOR}  `)?.company).toBe("Reaktor");
  });

  it("reads nothing else — not another page of the same site, nor another site", () => {
    expect(careerPageFor("https://www.reaktor.com/careers")).toBeNull();
    expect(careerPageFor("https://www.reaktor.com/careers/head-of-marketing")).toBeNull();
    expect(careerPageFor("https://example.com/careers/all-open-positions")).toBeNull();
    expect(careerPageFor("https://reaktor.com.example.com/careers/all-open-positions")).toBeNull();
    expect(careerPageFor("http://www.reaktor.com/careers/all-open-positions")).toBeNull();
    expect(careerPageFor("not an address")).toBeNull();
  });

  it("keeps an address tidy, and refuses one it cannot read", () => {
    expect(careerPageAddress("https://www.reaktor.com/careers/all-open-positions/?ref=x#top")).toBe(REAKTOR);
    expect(careerPageAddress("https://example.com/jobs")).toBeNull();
  });
});

describe("reading a page", () => {
  const source = careerPageFor(REAKTOR)!;

  it("takes each listed position: its title, its own address and where it is", () => {
    expect(source.positions(REAKTOR_HTML, REAKTOR).slice(0, 3)).toEqual([
      { url: "https://www.reaktor.com/careers/head-of-marketing", title: "Head of Marketing", cities: ["Helsinki"] },
      {
        url: "https://www.reaktor.com/careers/head-of-communications",
        title: "Head of Communications & Investor Relations",
        cities: ["Helsinki", "Turku"],
      },
      {
        // Made absolute, and a tracking parameter dropped.
        url: "https://www.reaktor.com/ja-jp/careers/senior-technical-lead-tokyo",
        title: "Senior Technical Lead",
        cities: ["Tokyo"],
      },
    ]);
  });

  it("leaves the page's navigation and footer links alone", () => {
    const urls = source.positions(REAKTOR_HTML, REAKTOR).map((p) => p.url);
    expect(urls.some((u) => u.includes("/locations/"))).toBe(false);
    expect(urls).not.toContain(REAKTOR);
  });

  it("finds nothing in a page with no rows, rather than guessing", () => {
    expect(source.positions("<html><body><a href='/careers/x'>A job</a></body></html>", REAKTOR)).toEqual([]);
  });
});

describe("a page's positions as links", () => {
  const source = careerPageFor(REAKTOR)!;
  const links = positionsAsLinks(source, REAKTOR, REAKTOR_HTML, "2026-10-07T09:00:00.000Z");

  it("names each after the employer and the role, once per address", () => {
    expect(links.map((l) => l.title)).toEqual([
      "Reaktor - Head of Marketing",
      "Reaktor - Head of Communications & Investor Relations",
      "Reaktor - Senior Technical Lead",
    ]);
  });

  it("carries the page where an email's rows carry the email", () => {
    expect(links[0]).toMatchObject({
      messageId: `page:${REAKTOR}`,
      subject: "Reaktor: open positions",
      date: "2026-10-07T09:00:00.000Z",
      cities: ["Helsinki"],
    });
    expect(isPageMessageId(links[0].messageId)).toBe(true);
    expect(pageUrlOf(links[0].messageId)).toBe(REAKTOR);
    expect(pageMessageId(REAKTOR)).toBe(links[0].messageId);
  });

  it("tells a page's rows from an email's", () => {
    expect(isPageMessageId("18c2f0a9b7")).toBe(false);
    expect(pageUrlOf("18c2f0a9b7")).toBeNull();
    expect(isPageMessageId(undefined)).toBe(false);
  });
});

describe("what the import writes about a posting from a page", () => {
  /** A service client that accepts everything and keeps what was inserted. */
  function makeAdmin() {
    const inserted: Record<string, Record<string, unknown>[]> = {};
    const from = (table: string) => {
      let op = "select";
      const self = {
        select: () => self,
        eq: () => self,
        in: () => self,
        order: () => self,
        limit: () => self,
        insert(rows: Record<string, unknown>[]) {
          op = "insert";
          (inserted[table] ??= []).push(...rows);
          return self;
        },
        maybeSingle: () => Promise.resolve({ data: { deadlines_enabled: true }, error: null }),
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(op === "insert" ? { data: null, error: null } : { data: [], error: null }).then(resolve, reject),
      };
      return self;
    };
    return { admin: { from } as never, inserted };
  }

  it("names the page, not an email that never was, and the city in the name", async () => {
    const { admin, inserted } = makeAdmin();
    const [first] = positionsAsLinks(careerPageFor(REAKTOR)!, REAKTOR, REAKTOR_HTML, "2026-10-07T09:00:00.000Z");
    await importLinksAsWorkItems(
      admin,
      { organizationId: "org", treeId: "org::bt-1", backlogId: "org::bl-1", allowDuplicates: true },
      [first],
    );
    const [item] = inserted.work_items;
    expect(item.title).toBe("Reaktor - Head of Marketing (Helsinki)");
    expect(item.description).toContain(`Career page: ${REAKTOR}`);
    expect(item.description).toContain("Found: 2026-10-07T09:00:00.000Z");
    expect(item.description).toContain("Link: https://www.reaktor.com/careers/head-of-marketing");
    expect(item.description).not.toMatch(/From email|Sender|Received/);
    expect(inserted.work_item_hyperlinks[0]).toMatchObject({ url: "https://www.reaktor.com/careers/head-of-marketing" });
  });
});

describe("how the picker words it", () => {
  const email = { messageId: "m-1" };
  const page = { messageId: `page:${REAKTOR}` };

  it("counts emails and career pages apart", () => {
    expect(emailCountOf([email, email, { messageId: "m-2" }, page])).toBe(2);
    expect(pageCountOf([email, page, page])).toBe(1);
  });

  it("says where the jobs were found", () => {
    expect(foundWhere(3, 0)).toBe("in 3 emails");
    expect(foundWhere(1, 1)).toBe("in 1 email and on 1 career page");
    expect(foundWhere(0, 2)).toBe("on 2 career pages");
    expect(foundWhere(0, 0)).toBe("in 0 emails");
  });

  it("puts the pages in the summary only when there are any", () => {
    expect(previewSummary({ shown: 5, emails: 2, mode: "jobs", fresh: 3 })).toBe(
      "5 jobs, out of which 3 seem new, found in 2 emails — pick what to import",
    );
    expect(previewSummary({ shown: 5, emails: 2, pages: 1, mode: "jobs", fresh: 3 })).toBe(
      "5 jobs, out of which 3 seem new, found in 2 emails and on 1 career page — pick what to import",
    );
  });

  it("says what a page holds beside the rows shown", () => {
    expect(careerPageLine({ total: 19, inLists: 12, skipped: 2 })).toBe(
      "19 open positions on the page · 12 already in your lists · 2 skipped earlier",
    );
    expect(careerPageLine({ total: 1, inLists: 0, skipped: 0 })).toBe("1 open position on the page");
  });

  it("names on the decline button what it does to how many of each", () => {
    expect(declineLabel(3, 0)).toBe("Do not import anything, mark 3 emails read");
    expect(declineLabel(1, 2)).toBe("Do not import anything, mark 1 email read, skip 2 career page jobs");
    expect(declineLabel(0, 1)).toBe("Do not import anything, skip 1 career page job");
  });

  it("reports what the button did", () => {
    expect(declinedSummary(2, 0)).toBe("2 emails marked as read");
    expect(declinedSummary(1, 5)).toBe("1 email marked as read, 5 career page jobs skipped");
    expect(declinedSummary(0, 1)).toBe("1 career page job skipped");
  });
});
