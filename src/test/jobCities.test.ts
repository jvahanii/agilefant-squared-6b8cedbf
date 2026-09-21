/**
 * Where a job is, read from its posting page and added to the item's name:
 * "0930 Fortum — Analyst (Espoo)".
 *
 * The pages under fixtures/ are real postings saved as the boards served them,
 * markup and all: a tidied page tests a shape no board produces.
 */
import { describe, it, expect, vi, afterEach } from "vitest";
import fs from "fs";
import { citiesFromList, citiesFromPage, withCities } from "../../supabase/functions/_shared/cities";
import { extractLinks, type GmailMessage } from "../../supabase/functions/_shared/extract";
import { factsFromPage, fillDeadlines } from "../../supabase/functions/_shared/fetchDeadline";

const page = (name: string) => fs.readFileSync(`src/test/fixtures/${name}`, "utf8");

describe("citiesFromPage, on real postings", () => {
  it("reads schema.org JobPosting data — Duunitori", () => {
    expect(citiesFromPage(page("duunitori-posting-espoo.html"))).toEqual(["Espoo"]);
  });

  it("reads schema.org JobPosting data — The Hub", () => {
    expect(citiesFromPage(page("thehub-posting-helsinki.html"))).toEqual(["Helsinki"]);
  });

  it("keeps every city of a posting open in several, in the order given — Jobly", () => {
    expect(citiesFromPage(page("jobly-posting-alma-media.html"))).toEqual(["Helsinki", "Tampere"]);
  });

  it("leaves out a region given where a city belongs — Jobly's \"Uusimaa\"", () => {
    const cities = citiesFromPage(page("jobly-posting-several-cities.html"));
    expect(cities.length).toBeGreaterThan(1);
    expect(cities).not.toContain("Uusimaa");
    expect(cities[0]).toBe("Helsinki");
  });

  it("reads LinkedIn's guest page: the first line, not the applicant count after it", () => {
    expect(citiesFromPage(page("linkedin-guest-posting-espoo.html"))).toEqual(["Espoo"]);
  });

  it("reads a jobs2web career site — Nordea's \"Helsinki, FI, 00500\"", () => {
    expect(citiesFromPage(page("jobs2web-nordea-posting-helsinki.html"))).toEqual(["Helsinki"]);
  });

  it("finds nothing on a Cloudflare challenge page", () => {
    expect(citiesFromPage(page("jobly-cloudflare-challenge.html"))).toEqual([]);
  });
});

describe("citiesFromPage, the traps", () => {
  const ld = (data: unknown) => `<script type="application/ld+json">${JSON.stringify(data)}</script>`;

  it("takes the job's location, never the employer's address", () => {
    const html = ld({
      "@type": "JobPosting",
      hiringOrganization: { "@type": "Organization", address: { addressLocality: "Stockholm" } },
      jobLocation: { "@type": "Place", address: { addressLocality: "Oulu" } },
    });
    expect(citiesFromPage(html)).toEqual(["Oulu"]);
  });

  it("keeps a foreign city, but not a country or a way of saying anywhere", () => {
    const html = ld({
      "@type": "JobPosting",
      jobLocation: [
        { address: { addressLocality: "Gdańsk" } },
        { address: { addressLocality: "Finland" } },
        { address: { addressLocality: "Remote" } },
      ],
    });
    expect(citiesFromPage(html)).toEqual(["Gdańsk"]);
  });

  it("splits one field that holds several, and drops repeats and postcodes", () => {
    const html = ld({ "@type": "JobPosting", jobLocation: { address: { addressLocality: "00510 Helsinki, Espoo / helsinki" } } });
    expect(citiesFromPage(html)).toEqual(["Helsinki", "Espoo"]);
  });

  it("does not take LinkedIn's applicant count for a place when no location is given", () => {
    const html = `<span class="topcard__flavor topcard__flavor--bullet">\n  39 applicants\n</span>`;
    expect(citiesFromPage(html)).toEqual([]);
  });

  it("survives structured data it cannot parse", () => {
    expect(citiesFromPage(`<script type="application/ld+json">{ not json</script>`)).toEqual([]);
  });
});

describe("withCities", () => {
  it("adds one city in parentheses", () => {
    expect(withCities("0930 Fortum — Management Assistant", ["Espoo"])).toBe("0930 Fortum — Management Assistant (Espoo)");
  });

  it("shows two cities, and the rest as a count", () => {
    expect(withCities("Verohallinto — ICT-asiantuntija", ["Helsinki", "Joensuu"])).toBe(
      "Verohallinto — ICT-asiantuntija (Helsinki, Joensuu)",
    );
    expect(withCities("HR with you — Open Application", ["Helsinki", "Tampere", "Vantaa", "Turku", "Oulu"])).toBe(
      "HR with you — Open Application (Helsinki, Tampere +3)",
    );
  });

  it("leaves a title alone when it already names one of the cities", () => {
    const nordea = "Nordea — Quant Developer, Nordea Markets - Helsinki, FI, 00500";
    expect(withCities(nordea, ["Helsinki"])).toBe(nordea);
  });

  it("matches a city only as a word of its own", () => {
    // "Espoonlahti" is not "Espoo".
    expect(withCities("Espoonlahden koulu — Opettaja", ["Espoo"])).toBe("Espoonlahden koulu — Opettaja (Espoo)");
  });

  it("is safe to run twice", () => {
    const once = withCities("Smartly — User Guidance Lead", ["Helsinki", "Tampere", "Oulu"]);
    expect(withCities(once, ["Helsinki", "Tampere", "Oulu"])).toBe(once);
  });

  it("leaves the title alone when no city is known", () => {
    expect(withCities("Droppe — AI Operations Manager", [])).toBe("Droppe — AI Operations Manager");
    expect(withCities("Droppe — AI Operations Manager", undefined)).toBe("Droppe — AI Operations Manager");
  });
});

describe("reading a posting for its city", () => {
  afterEach(() => vi.unstubAllGlobals());

  it("reports the cities along with the deadline", () => {
    const facts = factsFromPage(
      "https://duunitori.fi/tyopaikat/tyo/x",
      200,
      "text/html",
      page("duunitori-posting-espoo.html"),
      "2026-09-21",
    );
    expect(facts.cities).toEqual(["Espoo"]);
  });

  it("knows no cities for a page that never arrived", () => {
    const facts = factsFromPage("https://www.jobly.fi/tyopaikka/x", 403, "text/html", page("jobly-cloudflare-challenge.html"), "2026-09-21");
    expect(facts.cities).toBeUndefined();
  });

  it("reads a posting whose mail gave a date but whose city is unknown, and keeps the mail's date", async () => {
    const html = page("duunitori-posting-espoo.html");
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return new Response(html, { status: 200, headers: { "content-type": "text/html" } });
    });

    const [dated, known] = await fillDeadlines([
      { url: "https://duunitori.fi/tyopaikat/tyo/a", deadline: "2026-10-31" },
      // Read already, in the picker: not fetched again.
      { url: "https://duunitori.fi/tyopaikat/tyo/b", deadline: "2026-10-31", cities: ["Oulu"] },
    ]);

    expect(fetched).toEqual(["https://duunitori.fi/tyopaikat/tyo/a"]);
    expect(dated).toMatchObject({ deadline: "2026-10-31", cities: ["Espoo"] });
    expect(known.cities).toEqual(["Oulu"]);
  });
});

describe("Työmarkkinatori: the cities come from the alert mail", () => {
  // The posting page is an empty shell filled from /api/, which robots.txt
  // closes to automated clients, so the mail is the source. The fixture is a
  // real alert, markup as delivered; only the recipient's address and
  // unsubscribe tokens are replaced, at the same length.
  const alert = (): GmailMessage => ({
    id: "tmt-1",
    internalDate: "1789677992000",
    payload: {
      mimeType: "text/html",
      body: { data: Buffer.from(page("tyomarkkinatori-alert-two-postings.html"), "utf8").toString("base64url") },
      headers: [
        { name: "From", value: "Työmarkkinatori <noreply@tyomarkkinatori.fi>" },
        { name: "Subject", value: "Työmarkkinatori: Työpaikkavahdin löytämät uusimmat työpaikat" },
      ],
    },
  });

  it("reads each posting's cities from the line under its title, beside the employer and the closing date", () => {
    const links = extractLinks(alert(), "jobs");
    expect(links.map((l) => [l.url, l.company, l.deadline, l.cities])).toEqual([
      ["https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/1f93da93-4577-45e3-9edb-73c024fed812", "Joppl Oy", "2026-09-30", ["Espoo", "Helsinki"]],
      // "Useita sijainteja" — several locations, none named: known to have no city.
      ["https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/4462dd2f-7ca2-443e-9b2b-dabe73e4d2e8", "Academic Work Finland Oy", "2027-03-16", []],
    ]);
  });

  it("names the imported item after them", () => {
    const [first] = extractLinks(alert(), "jobs");
    expect(withCities(first.title, first.cities)).toBe("Joppl Oy — servicenow ITSM expert (Espoo, Helsinki)");
  });

  it("does not read the posting page at import once the mail has said", async () => {
    const fetched: string[] = [];
    vi.stubGlobal("fetch", async (url: string) => {
      fetched.push(url);
      return new Response("", { status: 200, headers: { "content-type": "text/html" } });
    });
    await fillDeadlines(extractLinks(alert(), "jobs"));
    expect(fetched).toEqual([]);
    vi.unstubAllGlobals();
  });

  it("leaves a country out of the list", () => {
    expect(citiesFromList("Espoo, Suomi")).toEqual(["Espoo"]);
  });
});
