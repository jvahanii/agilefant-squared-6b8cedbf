// Does a job ad ask for Finnish?
//
// Read from the ad's own text. The name of a job says what language its title
// was written in, which is not the question: plenty of ads written in English
// end with "fluent Finnish required", and some written in Finnish say that
// Finnish is not needed.
//
// An ad is believed first for what it says about the language, and only when
// it says nothing for the language it is written in — an ad in Finnish that
// never mentions languages is taken to expect its reader to know Finnish, and
// one in English not to. Which of the two a verdict rests on is kept with it.
//
// The phrases were collected from about two hundred real ads on the Finnish
// boards (October 2026), and each rule here answers something one of them
// said. Pure, so the server and the browser judge a page alike and the rules
// can be tested without a page.

export type FinnishNeed = 'required' | 'not_required';

export interface LanguageVerdict {
  finnish: FinnishNeed;
  /** 'stated': the ad says so. 'language': it says nothing, and this is the language it is written in. */
  basis: 'stated' | 'language';
  /** The words the verdict was read from, where the ad said so — for whoever asks why. */
  evidence?: string;
}

const NAMED: Record<string, string> = { auml: 'ä', ouml: 'ö', aring: 'å', Auml: 'Ä', Ouml: 'Ö', Aring: 'Å' };

/** Entities textFromHtml leaves in: hexadecimal ones, and the Finnish letters by name. */
function decoded(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&(auml|ouml|aring);/gi, (m, name) => NAMED[name] ?? m);
}

const FINNISH_EN = /\bFinnish\b/g;
/**
 * "Finnish" is the language when what follows treats it as one — "Finnish and
 * English", "Finnish is a plus", "Finnish skills" — or when what precedes
 * does: "fluent in Finnish", "conversational Finnish". Anything else is the
 * adjective: "our Finnish support organization", "Finnish citizenship", "the
 * Finnish market".
 */
const LANGUAGE_AFTER =
  /^\s*(?:$|[,/&:–-]|and\b|or\b|is\b|are\b|as\b|at\b|would\b|will\b|not\b|though\b|but\b|language|skills?\b|proficien|fluen|speak|written\b|spoken\b|verbal\b|writing\b|communication|preferred|required|needed|level\b)/i;
const LANGUAGE_BEFORE =
  /(?:\bin|\bof|\bspeaks?|\bspeaking|\bfluent|\bnative|\bconversational|\bprofessional|\bbasic|\bgood|\bexcellent|\bstrong|\bsome|\bboth|\band|\bor|\bwith|\brequires?|\bneeds?|[-–]level|,)\s+$/i;
const NOT_A_LANGUAGE =
  /^[- ]+(?:citizen|national|passport|market|law|legislation|compan|customer|client|work permit|residen|security|government|public|society|team|office|business|start-?up|industr|operation|organi[sz]ation|subsidiar|support|defen[cs]e|culture|educat|universit|econom|tax|social|personal|identity|bank|authorit|army|militar|employment|labou?r|collective|holiday|summer|winter|nature|sauna|unit|branch|entity|colleague|speaking (?:market|customer|client|countr))/i;

/**
 * Finnish as a language, said in Finnish. "suomea" and "suomeksi" in lower
 * case are the language; "Suomea" with a capital is the country ("eri puolille
 * Suomea"), which is why those two are matched as written.
 */
const FINNISH_FI = [
  /suomen(?:\s+|\s+ja\s+[a-zåäö]+\s+|,\s*[a-zåäö]+\s+ja\s+[a-zåäö]+\s+)kiel[a-zåäö]*/gi,
  /(?<![A-Za-zÅÄÖåäö-])suomea(?![a-zåäö])/g,
  /(?<![A-Za-zÅÄÖåäö-])suomeksi(?![a-zåäö])/g,
  /äidinkiel[a-zåäö]*\s+(?:on\s+)?suomi|(?<![A-Za-zÅÄÖåäö-])suomi\s+äidinkiel[a-zåäö]*|kielitai[a-zåäö]*:?\s+suomi/gi,
];

/**
 * The state's own job board lists languages as a table, "Suomi Suullinen
 * osaaminen: Erinomainen …". A language listed there with a level is asked for.
 */
const STATE_TABLE = /Suomi\s+Suullinen osaaminen:\s*(?:Erinomainen|Hyvä|Tyydyttävä)/;

/** Where one statement ends and the next begins. */
const CLAUSE_END = /[.;!?()•✅|]/;

/** How far either side of the word a statement about it is looked for. */
const REACH = 70;

/**
 * Where a run-on list of requirements gives way to the next one: "Hyvää
 * suomen ja englannin kielen taitoa Lisäksi katsomme eduksi: …", "… taitoa
 * Eduksi luetaan: …". What is welcome there is whatever the next list names.
 */
const NEXT_LIST =
  /\blisäksi\b|\bkatsomme eduksi\b|\beduksi (?:luetaan|katsotaan|lasketaan)\b|\bin addition\b|\badditionally\b|\b(?:nice to haves?|bonus(?:es)?|plus(?:es)?|advantages?|eduksi|plussaa)\s*:/i;

/** Another language, by name. */
const OTHER_LANGUAGE =
  /\b(?:English|Swedish|German|Norwegian|Danish|Estonian|Russian|French|Spanish|englannin|englanti|englantia|englanniksi|ruotsin|ruotsi|ruotsia|ruotsiksi|saksan|norjan|venäjän|viron)\b/i;
/** All that stands between two languages named together: "Finnish or Swedish", "suomen ja ruotsin". */
const JOINED = /^\s*(?:,|\/|&|or|and|tai|ja|sekä)?\s*$/i;

/**
 * What follows the word, as far as it is still about Finnish. "Hyvä suomen
 * kielen taito, englannin kieli eduksi" asks for Finnish and welcomes
 * English: what comes after another language is said of that one — unless the
 * two are named together, as in "Finnish or Swedish skills are an advantage".
 */
function stillAboutFinnish(after: string): string {
  const kept = after.split(NEXT_LIST)[0];
  let from = 0;
  for (;;) {
    const next = kept.slice(from).match(OTHER_LANGUAGE);
    if (!next || next.index === undefined) return kept;
    const between = kept.slice(from, from + next.index);
    if (!JOINED.test(between)) return kept.slice(0, from + next.index);
    from += next.index + next[0].length;
  }
}

/** After the word: Finnish is welcome, and not asked for. */
const NOT_REQUIRED_AFTER =
  /\bnot (?:be )?(?:required|needed|necessary|mandatory|essential|a must|a requirement)|n['’]t (?:need|require)|\b(?:is|are|as|be)(?: considered| seen| regarded| counted)?(?: as)? (?:a |an )?(?:big |strong |definite |clear |great |real )?(?:plus|advantage|asset|bonus|benefit|merit)\b|\badvantage|\ba plus\b|nice to have|beneficial|appreciated|helpful|preferred|preferabl|desirable|optional|eduksi|plussaa|\betu\b|ei (?:ole )?(?:välttämät|pakolli|edellyt|vaadi|vaatimu|este)|ei tarvi|ei haittaa/i;
/** Before it: "no Finnish needed", "ideally you speak Finnish". */
const NOT_REQUIRED_BEFORE =
  /\b(?:no|not|without|n['’]t need|n['’]t require|not need|not require|no need for|ei edellytä|ei vaadi|et tarvitse|ei tarvita)\s+(?:\w+\s+){0,3}$|\b(?:preferably|ideally|optionally|bonus points|mielellään)\b/i;

/** Either side of the word: Finnish is asked for. */
const REQUIRED =
  /\bfluen\w+|\bproficien\w+|\bnative\b|\bexcellent\b|\bgood\b|\bstrong\b|\bsolid\b|\bprofessional\b|\bconversational\b|\bspoken\b|\bwritten\b|\bspeak\w*|\brequire[sd]?\b|\bmust\b|\bmandatory\b|\bessential\b|\bnecessary\b|\bneeded\b|\bskills?\b|\bcommand of\b|\bworking language|\bEnglish\b|\bboth\b|sujuva|erinomai|hyvä|vahva|äidinkiel|edellyt|vaadi|vaati|tarvit|vaatimu|työkiel|odotamme|kykenet|osaat|hallitset|taito|taido|viestit|viestintä|kommunikoi|dokumentoi|työskentelet|kirjalli|suulli|kielitai/i;

/**
 * A sentence about the language of the application or of its papers, not of
 * the job: "you may apply in Finnish or English", "voit jättää hakemuksesi
 * suomeksi", "if your degree certificate is not in English, Finnish or
 * Swedish".
 */
const ABOUT_PAPERS =
  /hakemu|ansioluettel|todistu|käännö|\bapplication|\bapply\b|\bCV\b|\bresume\b|cover letter|certificate|transcript|diploma|translation|\bdocuments?\b/i;
/** A site's own menu: "Työpaikat suomeksi", "Change language … Finnish". */
const SITE_MENU = /Työpaikat suomeksi|Jobs in English|Change language|Vaihda kieli|Valitse kieli|Choose language/i;

/** What the statement around one mention of the language says, if anything. */
function statement(
  text: string,
  at: number,
  length: number,
  english: boolean,
): { need: FinnishNeed; clause: string } | undefined {
  let from = at;
  while (from > 0 && at - from < REACH && !CLAUSE_END.test(text[from - 1])) from--;
  let to = at + length;
  while (to < text.length && to - (at + length) < REACH && !CLAUSE_END.test(text[to])) to++;
  const before = text.slice(from, at);
  const whole = text.slice(at + length, to);
  const clause = before + text.slice(at, at + length) + whole;

  if (english && !LANGUAGE_AFTER.test(whole) && !(LANGUAGE_BEFORE.test(before) && !NOT_A_LANGUAGE.test(whole))) {
    return undefined;
  }
  if (ABOUT_PAPERS.test(clause) || SITE_MENU.test(clause)) return undefined;

  const after = stillAboutFinnish(whole);
  if (NOT_REQUIRED_AFTER.test(after) || NOT_REQUIRED_BEFORE.test(before)) return { need: 'not_required', clause };
  if (REQUIRED.test(before) || REQUIRED.test(after)) return { need: 'required', clause };
  return undefined;
}

/** Words an ad uses when it is talking to its reader, in each language. */
const PROSE_FI =
  /(?<![a-zåäö])(?:olet|sinulla|sinulle|sinua|sinun|sinut|meillä|meille|tarjoamme|haemme|etsimme|työskentelet|tehtävässä|tehtäviisi|osaamista|kokemusta|arvostamme|toivomme|edellytämme|pääset|kanssa|sekä|myös)(?![a-zåäö])/gi;
const PROSE_EN = /\b(?:you|your|we|our|will|with|and|the|experience|team)\b/gi;

/**
 * The language the ad is written in, when there is enough of it to tell. A
 * page that holds only a site's menus — a board that draws its ads with
 * script, a posting that has been taken down — has no ad to judge, and says
 * nothing.
 */
function writtenIn(text: string): 'fi' | 'en' | undefined {
  const fi = text.match(PROSE_FI)?.length ?? 0;
  const en = text.match(PROSE_EN)?.length ?? 0;
  // English leans on its small words far more than Finnish does on these, so
  // the two counts are not weighed one for one. Set from the ads sampled: an
  // ad in Finnish had 10–48 of the Finnish words, and up to 127 of the English
  // ones from an English site around it; an ad in English had 55–279 of the
  // English ones, and up to 8 Finnish ones from a Finnish board's menus; a
  // page with no ad on it had at most 15 of either.
  if (fi >= 10 && fi * 8 >= en) return 'fi';
  if (en >= 40 && en > fi * 10) return 'en';
  return undefined;
}

/**
 * What an ad's text says about needing Finnish, or nothing when it cannot be
 * told. The first thing the ad says is the one believed: an aggregator's page
 * carries teasers of other ads beneath the one it is about.
 */
export function finnishRequirement(pageText: string): LanguageVerdict | undefined {
  const text = decoded(pageText);

  const found: { at: number; need: FinnishNeed; clause: string }[] = [];
  const consider = (pattern: RegExp, english: boolean) => {
    for (const m of text.matchAll(pattern)) {
      const said = statement(text, m.index ?? 0, m[0].length, english);
      if (said) found.push({ at: m.index ?? 0, ...said });
    }
  };
  consider(FINNISH_EN, true);
  for (const pattern of FINNISH_FI) consider(pattern, false);
  const table = text.match(STATE_TABLE);
  if (table) found.push({ at: table.index ?? 0, need: 'required', clause: table[0] });

  if (found.length > 0) {
    found.sort((a, b) => a.at - b.at);
    return { finnish: found[0].need, basis: 'stated', evidence: found[0].clause.replace(/\s+/g, ' ').trim() };
  }

  const language = writtenIn(text);
  if (language === 'fi') return { finnish: 'required', basis: 'language' };
  if (language === 'en') return { finnish: 'not_required', basis: 'language' };
  return undefined;
}
