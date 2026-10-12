/**
 * Does a job ad ask for Finnish? Read from the ad's text.
 *
 * The sentences here are the ones real ads used (October 2026, about two
 * hundred ads from the Finnish boards), each with the answer a reader would
 * give. The rule was written against half of them and checked against the
 * other half; what it got wrong then is pinned here too.
 */
import { describe, it, expect } from "vitest";
import { finnishRequirement } from "../../supabase/functions/_shared/languageRequirement";
import { languageRows } from "../../supabase/functions/_shared/postingLanguage";
import { factsFromPage, fillDeadlines } from "../../supabase/functions/_shared/fetchDeadline";

const need = (text: string) => finnishRequirement(text)?.finnish;
const basis = (text: string) => finnishRequirement(text)?.basis;

describe("an ad written in English that asks for Finnish", () => {
  it.each([
    "Good written and spoken Finnish and English skills are required Interested?",
    "Please note this role requires both Finnish and English speaking",
    "A strong drive to provide top-quality support fluency both in Finnish and English detail-oriented mindset",
    "Fluent Finnish and English, with exceptionally strong Finnish writing skills — the role involves a lot of writing",
    "Fluency in both Finnish and English (written & spoken).",
    "Fluent Finnish and English are required",
    "Fluent communication skills in both Finnish and English Why Elisa",
    "Excellent Finnish language skills as well as good written and spoken English",
    "Professional-level Finnish in addition to English",
    "- Interest towards embedded software concepts - Fluency in Finnish Anything else?",
    "knowledge of asset data lifecycles, and fluent English with conversational Finnish.",
    "Some of our customers require Finnish language skills from our experts working with their assignments.",
    "Many of our current customer engagements require Finnish, though we also run projects where the working language is English",
    "working closely with Motion Designers Finnish language skills Adaptability Willingness to work in a hybrid setup.",
    "Fluency in English and Finnish; Swedish is an advantage",
    "Fluent Finnish and English language skills. Swedish or Norwegian is considered an advantage.",
  ])("%s", (sentence) => {
    expect(finnishRequirement(sentence)).toMatchObject({ finnish: "required", basis: "stated" });
  });
});

describe("an ad that welcomes Finnish without asking for it", () => {
  it.each([
    "Finnish is not required. We support relocation for the right person.",
    "Excellent written and spoken English; Finnish is an advantage University degree in business",
    "Language. Fluency in English. Finnish is considered an advantage.",
    "Excellent English language skills. Finnish or Swedish language skills are considered an advantage.",
    "You work fluently in English. Finnish or another European language is an advantage.",
    "Finnish skills are seen as an advantage",
    "Fluent working English, with Finnish as a bonus",
    "Fluency in both English and Finnish is preferable Why join us",
    "Ideally you also speak Finnish.",
    "No Finnish needed: the team works in English.",
  ])("%s", (sentence) => {
    expect(finnishRequirement(sentence)).toMatchObject({ finnish: "not_required", basis: "stated" });
  });
});

describe("an ad written in Finnish", () => {
  it.each([
    "Viestit sujuvasti suomeksi ja englanniksi, viet asiat loppuun asti",
    "hyvä paineensietokyky sujuva suomen ja englannin kielen taito aito kiinnostus IT-alaa",
    "Edellytetään suomen, ruotsin ja englannin kielen taitoa.",
    "Kielitaitovaatimuksena on suomen kielen hyvä suullinen ja kirjallinen taito ja ruotsin kielen tyydyttävä taito",
    "- hyvät suulliset ja kirjalliset viestintätaidot suomeksi - hyvät kirjalliset englannin kielen taidot",
    "Tehtävässä tarvitaan erinomaista suomen kielen ja vähintään tyydyttävää ruotsin kielen taitoa",
    "Käytämme työkielinä sekä suomea että englantia, joten odotamme, että kykenet työskentelemään molemmilla",
    "Työskentelet sujuvasti sekä suomeksi että englanniksi.",
    "Ruotsi Suullinen osaaminen: Tyydyttävä Suomi Suullinen osaaminen: Erinomainen Kirjallinen osaaminen: Erinomainen",
    // The entities the state's board leaves in its pages.
    "Teht&#xE4;v&#xE4;ss&#xE4; tarvitaan erinomaista suomen kielen taitoa sek&#xE4; sujuvaa englannin kielen taitoa.",
  ])("asks for it: %s", (sentence) => {
    expect(finnishRequirement(sentence)).toMatchObject({ finnish: "required", basis: "stated" });
  });

  it.each([
    "Suomen kielen taito ei ole välttämätön, työkielemme on englanti.",
    "Suomen kielen taito katsotaan eduksi.",
    "Tehtävä ei edellytä suomen kielen taitoa.",
  ])("and can say it does not: %s", (sentence) => {
    expect(finnishRequirement(sentence)).toMatchObject({ finnish: "not_required", basis: "stated" });
  });
});

describe("what is welcome in the next breath is not said of Finnish", () => {
  it.each([
    // The next list's heading, run on without a full stop.
    "Hyvää suomen ja englannin kielen taitoa Lisäksi katsomme eduksi: Kokemuksen sekä ensiö- että toisiojärjestelmistä",
    "Hyvän suullisen ja kirjallisen suomen ja englannin kielen taidon Tämän lisäksi katsomme eduksi, jos sinulla on kokemusta",
    "Hyvää suomen ja englannin kielen kirjallista ja suullista taitoa Eduksi luetaan: Oma-aloitteisuus",
    // Another language is the one that is welcome.
    "B-ajokortti Hyvä suomen kielen taito, englannin kieli eduksi Valmius ylitöihin",
    "Sujuvaa suomen ja englannin kielen taitoa Ruotsin kielen taito katsotaan tehtävässä eduksi",
    "Erinomaiset viestintätaidot suomeksi ja englanniksi (ruotsi/muut kielet katsotaan eduksi)",
    "Fluent Finnish Nice to have: experience with Kubernetes",
  ])("%s", (sentence) => {
    expect(need(sentence)).toBe("required");
  });
});

describe("the word, where it is not about the language of the job", () => {
  it.each([
    "This position requires Finnish citizenship due to client and security regulations.",
    "join our Finnish support organization to strengthen IT services for our businesses",
    "Strong knowledge of the Finnish market and its customers is required.",
    "You can submit your application in Finnish or English.",
    "Voit jättää hakemuksesi suomeksi tai englanniksi.",
    "If your degree certificate is not in English, Finnish, or Swedish, you must provide official English translations",
    "Suosikit Jobs in English Jobb på svenska Työpaikat suomeksi Etsi Viimeisimmät haut",
    "Change language English (United Kingdom) Finnish Already working at the company?",
    "ammattilaisia tuulipuistohankkeisiin eri puolille Suomea! Katso Helsinki ja 4 muuta",
    "112 Suomi -sovellus, hätätekstiviestipalvelu",
  ])("%s", (sentence) => {
    expect(finnishRequirement(sentence)).toBeUndefined();
  });
});

describe("an ad that says nothing about languages", () => {
  const finnishAd =
    "Haemme kokenutta arkkitehtia. Sinulla on kokemusta pilvipalveluista ja olet tottunut työskentelemään asiakkaiden kanssa. " +
    "Tarjoamme sinulle joustavan työn sekä hyvät edut. Meillä pääset kehittämään osaamista, ja arvostamme myös aloitteellisuutta. " +
    "Toivomme, että olet utelias. Etsimme tekijää, joka viihtyy tiimissä. Tehtävässä työskentelet myös kumppaneiden kanssa.";
  const englishAd = (
    "We are looking for an engineer to join our team. You will work with the platform team and the product owners, and you " +
    "bring experience with distributed systems. Our customers rely on the service, and we care about the quality of your work. "
  ).repeat(3);

  it("is taken to expect Finnish when it is written in Finnish", () => {
    expect(finnishRequirement(finnishAd)).toEqual({ finnish: "required", basis: "language" });
  });

  it("and not to when it is written in English", () => {
    expect(finnishRequirement(englishAd)).toEqual({ finnish: "not_required", basis: "language" });
  });

  it("but what the ad says outweighs the language it says it in", () => {
    expect(finnishRequirement(englishAd + " Fluent Finnish is required.")).toMatchObject({ finnish: "required", basis: "stated" });
    expect(finnishRequirement(finnishAd + " Suomen kielen taito ei ole välttämätön.")).toMatchObject({
      finnish: "not_required",
      basis: "stated",
    });
  });

  it("is still an English ad inside a Finnish board's menus", () => {
    const menus = "Etsi Viimeisimmät haut Kirjaudu Suosikit Avoimet työpaikat Työnantajat sekä kumppanit. Katso myös: ";
    expect(need(menus + englishAd)).toBe("not_required");
  });
});

describe("a page with no ad on it", () => {
  it.each([
    // A board that draws its ads with script: the page is its menus.
    "Hyppää sisältöön Haku Ohjeet ja tuki Suomi (FI) Valitse kieli. Välj språk. Choose language. Kirjaudu sisään Hae Sulje haku Valikko",
    "Sorry, this position has been filled. Contact us General terms Privacy policy Cookies Site feedback",
    "",
  ])("says nothing: %s", (text) => {
    expect(finnishRequirement(text)).toBeUndefined();
  });
});

describe("what is believed and why", () => {
  it("is the first thing the ad says: an aggregator lists other ads beneath it", () => {
    const page = "Finnish is not required. … Muut työpaikat: Myyjä — sujuva suomen kielen taito.";
    expect(need(page)).toBe("not_required");
  });

  it("comes with the ad's own words", () => {
    expect(finnishRequirement("We offer lunch. Fluent Finnish is a must. Apply today.")?.evidence).toBe(
      "Fluent Finnish is a must",
    );
    expect(basis("Fluent Finnish is a must.")).toBe("stated");
  });
});

describe("reading a posting's page", () => {
  const page = (body: string) => `<html><body><h1>Engineer</h1><p>${body}</p></body></html>`;

  it("answers the language question with the rest", () => {
    const facts = factsFromPage("https://example.fi/a", 200, "text/html", page("Fluent Finnish is required."), "2026-10-12");
    expect(facts.language).toMatchObject({ finnish: "required", basis: "stated" });
  });

  it("says the page was read and does not say, which is not the same as never having read it", () => {
    expect(factsFromPage("https://example.fi/a", 200, "text/html", page("Menu"), "2026-10-12").language).toBeNull();
    // An ad that is gone has nothing left to read, now or later.
    expect(factsFromPage("https://example.fi/a", 404, "text/html", "", "2026-10-12")).toEqual({ closed: true, language: null });
    // A board that would not answer has told us nothing: ask again another day.
    expect(factsFromPage("https://example.fi/a", 429, "text/html", "", "2026-10-12")).toEqual({ unreachable: 429 });
  });

  it("is not read again by an import that already knows the deadline and the city", async () => {
    const links = [{ url: "https://example.fi/a", deadline: "2026-11-01", cities: ["Espoo"] }];
    expect(await fillDeadlines(links)).toEqual(links);
  });
});

describe("what is kept of it", () => {
  const NOW = new Date("2026-10-12T12:00:00Z");

  it("is one row per address, under a hash the database can compute from the link", async () => {
    const rows = await languageRows(
      [
        { url: "https://example.fi/ad/1?utm=ä", language: { finnish: "required", basis: "stated", evidence: "Fluent Finnish" } },
        { url: "https://example.fi/ad/1?utm=ä", language: { finnish: "required", basis: "stated", evidence: "Fluent Finnish" } },
      ],
      NOW,
    );
    expect(rows).toEqual([
      {
        // sha256 of the address as UTF-8, in hex — what Postgres makes of
        // encode(sha256(convert_to(url, 'UTF8')), 'hex').
        url_hash: "0ac4a01644ea1caf00d3e30713cb43e6aa8fe3ea0eb443db0bf1c10b9130407d",
        finnish: "required",
        basis: "stated",
        evidence: "Fluent Finnish",
        read_at: "2026-10-12T12:00:00.000Z",
      },
    ]);
  });

  it("keeps a page that was read and did not say, so it is not asked again, and nothing for one never read", async () => {
    const rows = await languageRows(
      [
        { url: "https://example.fi/gone", language: null },
        { url: "https://example.fi/refused" },
      ],
      NOW,
    );
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ finnish: null, basis: null, evidence: null });
  });

  it("keeps no more of the ad's words than explains the verdict", async () => {
    const [row] = await languageRows(
      [{ url: "https://example.fi/a", language: { finnish: "required", basis: "stated", evidence: "x".repeat(900) } }],
      NOW,
    );
    expect(row.evidence).toHaveLength(300);
  });
});
