import { describe, it, expect } from 'vitest';
import {
  parseDeadline,
  deadlinePrefix,
  deadlinePassed,
  titleDeadline,
  parseOpenEnded,
  parseApplicationsClosed,
} from '../../supabase/functions/_shared/deadlines';
import {
  closedByStatus,
  isLinkedInGuest,
  linkedInApplyWithdrawn,
  postingTextUrl,
  textFromHtml,
} from '../../supabase/functions/_shared/fetchDeadline';

/**
 * Deadlines come from the mail, not from fetching the posting. Only the Finnish
 * boards state one, and they usually omit the year -- so the date the mail
 * arrived decides which year "11.3." means.
 */

const SEPT = '2026-09-11T00:00:00.000Z';

describe('parseApplicationsClosed', () => {
  it('reads LinkedIn, which leaves closed postings up', () => {
    expect(parseApplicationsClosed('Director, AI Transformation. No longer accepting applications')).toBe(true);
    expect(parseApplicationsClosed('Not currently accepting applications')).toBe(true);
  });

  it('reads the phrasings other boards use', () => {
    expect(parseApplicationsClosed('Applications are closed')).toBe(true);
    expect(parseApplicationsClosed('Hakuaika on päättynyt')).toBe(true);
  });

  it('reads Duunitori refusing an expired application', () => {
    // Quoted from the banner. The object of the sentence sits between "haku"
    // and "on päättynyt", which is why requiring them adjacent saw none of
    // these.
    expect(parseApplicationsClosed('Pahoittelut, haku tähän avoimeen työpaikkaan on päättynyt')).toBe(true);
    expect(parseApplicationsClosed('Hakuaika on päättynyt')).toBe(true);
  });

  it('does not join two sentences into a closure', () => {
    expect(parseApplicationsClosed('Hakuprosessi on sujuva. Edellinen projekti on päättynyt.')).toBe(false);
  });

  it('reads an applicant tracking system refusing the form', () => {
    expect(parseApplicationsClosed('Not available. Job is not open for applying.')).toBe(true);
    expect(parseApplicationsClosed('This role is not open for applications')).toBe(true);
  });

  it('reads a Finnish board withdrawing the ad', () => {
    // Quoted from the banner. It says nothing about applications, only that the
    // posting itself has lapsed.
    expect(parseApplicationsClosed('Tämä työpaikkailmoitus ei ole enää voimassa. Etsi muita työpaikkoja.')).toBe(true);
    expect(parseApplicationsClosed('Tämä paikka ei ole enää haettavissa')).toBe(true);
  });

  it('reads a "gone" page served under a 200', () => {
    expect(parseApplicationsClosed('Page not found. Unable to find job. Back to home')).toBe(true);
    expect(parseApplicationsClosed('This position is no longer available')).toBe(true);
    // Quoted from an applicant tracking system's own gone-page.
    expect(parseApplicationsClosed('This job is no longer available. You may also VIEW ALL JOBS')).toBe(true);
    expect(parseApplicationsClosed('This role is no longer available')).toBe(true);
  });

  it('needs to know what is no longer available', () => {
    // On its own the phrase could be about anything a posting mentions.
    expect(parseApplicationsClosed('No longer available')).toBe(false);
    expect(parseApplicationsClosed('The Tampere office is no longer available for this team')).toBe(false);
  });

  it('says nothing about a posting that is still open', () => {
    expect(parseApplicationsClosed('Apply by 30.9. — we are accepting applications')).toBe(false);
    expect(parseApplicationsClosed('Over 100 people clicked apply')).toBe(false);
    expect(parseApplicationsClosed('')).toBe(false);
  });

  it('does not read some other lapsed thing as the ad lapsing', () => {
    // The Finnish rule needs the posting named, and cannot reach across a full
    // stop to borrow the noun from a neighbouring sentence.
    expect(parseApplicationsClosed('Edellytämme, että ajokortti ei ole enää voimassa olevia rajoituksia')).toBe(false);
    expect(parseApplicationsClosed('Työpaikka on Helsingissä. Vanha tarjous ei ole enää voimassa.')).toBe(false);
  });
});

describe('closedByStatus', () => {
  it('treats a removed posting as closed', () => {
    expect(closedByStatus(404)).toBe(true);
    expect(closedByStatus(410)).toBe(true);
  });

  it('treats a board refusing us as nothing known', () => {
    // Rate limiting and bot blocking say nothing about the ad. Reading them as
    // closed would shut a whole backlog the moment a board pushed back.
    expect(closedByStatus(403)).toBe(false);
    expect(closedByStatus(429)).toBe(false);
    expect(closedByStatus(500)).toBe(false);
    expect(closedByStatus(200)).toBe(false);
  });
});

describe('parseDeadline', () => {
  it('reads Duunitori "haku päättyy"', () => {
    expect(parseDeadline('Steady Energy Oy, Espoo - haku päättyy 20.9.', SEPT)).toBe('2026-09-20');
  });

  it('takes the end of a Duunitori application period', () => {
    // "Hakuaika 11.9 - 11.3." is a range; the deadline is the second date, and
    // in a September mail it falls next year.
    expect(parseDeadline('Academic Work, Espoo - Hakuaika 11.9 - 11.3.', SEPT)).toBe('2027-03-11');
  });

  it('reads the closing date from a Duunitori listing header', () => {
    // "Published 10.9. (Ends 30.9.)" — the published date sits immediately
    // before the one that matters, so the parentheses do the choosing.
    expect(parseDeadline('Project Manager, Aalto-yliopisto. Published 10.9. (Ends 30.9.)', SEPT))
      .toBe('2026-09-30');
    expect(parseDeadline('Julkaistu 10.9. (Päättyy 30.9.)', SEPT)).toBe('2026-09-30');
    expect(deadlinePrefix(parseDeadline('Published 10.9. (Ends 30.9.)', SEPT))).toBe('0930');
  });

  it('reads the header once it has turned past-tense', () => {
    // Duunitori rewrites "(Päättyy 26.7.)" as "(Päättynyt 26.7.)" after the day
    // passes. The date still is the deadline, and one already gone by is worth
    // knowing.
    expect(parseDeadline('Julkaistu 13.7. ( Päättynyt 26.7. )', '2026-07-13T00:00:00.000Z')).toBe('2026-07-26');
  });

  it('does not read a contract\'s end date as a deadline', () => {
    // Only the parenthesised form counts: prose about when a job ends is not
    // a statement about when to apply, and a wrong date lands in the item name.
    expect(parseDeadline('A fixed-term role; the contract ends 31.12.', SEPT)).toBeUndefined();
  });

  it('reads "hakuaika päättyy", with the words either side of "aika"', () => {
    expect(parseDeadline('Hakuaika päättyy 30.9.', SEPT)).toBe('2026-09-30');
  });

  it('reads Työmarkkinatori, which states the year', () => {
    expect(parseDeadline('Lokki Oy - Haku päättyy 27.09.2026 19.00', SEPT)).toBe('2026-09-27');
  });

  it('honours an explicit year over the mail date', () => {
    expect(parseDeadline('haku päättyy 20.9.2028', SEPT)).toBe('2028-09-20');
  });

  it('keeps a deadline that falls on the day the mail arrived', () => {
    expect(parseDeadline('haku päättyy 11.9.', SEPT)).toBe('2026-09-11');
  });

  it('rolls to next year when the day has already passed', () => {
    expect(parseDeadline('haku päättyy 1.3.', SEPT)).toBe('2027-03-01');
  });

  it('finds nothing where there is nothing', () => {
    // Jobly's third field is the posting date, not a deadline, and LinkedIn
    // states neither -- both must come back undefined rather than guessed.
    expect(parseDeadline('Academic Work | Tuusula, Helsinki | 12.09.2026', SEPT)).toBeUndefined();
    expect(parseDeadline('If Insurance · Espoo, Uusimaa, Finland', SEPT)).toBeUndefined();
    expect(parseDeadline('', SEPT)).toBeUndefined();
  });

  it('rejects an impossible date rather than rolling it over', () => {
    expect(parseDeadline('haku päättyy 31.2.', SEPT)).toBeUndefined();
    expect(parseDeadline('haku päättyy 45.13.', SEPT)).toBeUndefined();
  });

  it('survives an unusable reference date', () => {
    expect(parseDeadline('haku päättyy 20.9.', 'not a date')).toBeUndefined();
  });

  it('reads an English phrasing, should a board switch locale', () => {
    expect(parseDeadline('Apply by 20.9.2026', SEPT)).toBe('2026-09-20');
  });

  /**
   * Helsingin kaupunki, on LinkedIn: no deadline word anywhere, just a date and
   * the postposition that governs it. The sentence is quoted from the posting.
   */
  it('reads a date governed by "mennessä"', () => {
    const text =
      'Jos tunnistat osaamisesi ja kokemuksesi tehtävän ydinsisällöistä, jätä hakemuksesi ' +
      'rekrytointijärjestelmämme kautta 30.9.2026 klo 16 mennessä.';
    expect(parseDeadline(text, SEPT)).toBe('2026-09-30');
    expect(deadlinePrefix(parseDeadline(text, SEPT))).toBe('0930');
  });

  it('reads "mennessä" without a clock time, and with minutes', () => {
    expect(parseDeadline('Hakemukset 30.9.2026 mennessä.', SEPT)).toBe('2026-09-30');
    expect(parseDeadline('Hae 30.9. klo 16.00 mennessä', SEPT)).toBe('2026-09-30');
    expect(parseDeadline('Hae 30.9.2026 klo 16:00 mennessä', SEPT)).toBe('2026-09-30');
  });

  /**
   * Quoted from a posting. The word "application" is 58 characters from the
   * date, which the older patterns did not reach across -- only the preposition
   * is adjacent to it.
   */
  it('reads a month name governed by "by", however far the lead-in', () => {
    const text =
      'If you see that you have the experience and qualities to be successful in this role, ' +
      'please submit your application with your updated CV and cover letter via Careers site ' +
      'by September 25th 2026.';
    expect(parseDeadline(text, SEPT)).toBe('2026-09-25');
    expect(deadlinePrefix(parseDeadline(text, SEPT))).toBe('0925');
  });

  it('reads the same phrasing day-first, and numerically', () => {
    expect(parseDeadline('Please submit your CV by 25 September 2026', SEPT)).toBe('2026-09-25');
    expect(parseDeadline('Send your application via the portal by 25.9.2026', SEPT)).toBe('2026-09-25');
    expect(parseDeadline('Applications no later than September 25th, 2026', SEPT)).toBe('2026-09-25');
  });

  it('does not read a start date as a deadline', () => {
    // No submission word at all: "by" alone governs plenty of dates that are
    // nobody's deadline.
    expect(parseDeadline('We would like you to start by September 1st 2026.', SEPT)).toBeUndefined();
    // And a submission word in the previous sentence does not reach into this
    // one, which is what the full stop in the gap is there to prevent.
    expect(parseDeadline('Please submit your application. The role starts by September 1st 2026.', SEPT))
      .toBeUndefined();
  });

  /**
   * Postings name the weekday as often as not, and a pattern wanting the date
   * immediately after the preposition saw none of these. All quoted from real
   * ads.
   */
  it('reads past a weekday standing between the deadline word and the date', () => {
    expect(
      parseDeadline(
        'Submit your application with your CV, cover letter and salary expectation as soon as ' +
          'possible, but no later than Sunday, 4 October 2026.',
        SEPT,
      ),
    ).toBe('2026-10-04');
    expect(
      parseDeadline('Hienoa! Hae tehtävään viimeistään keskiviikkona 30.9.2026 ja liitä hakuun CV:si', SEPT),
    ).toBe('2026-09-30');
  });

  it('reads the Swedish phrasing, which is one word', () => {
    expect(
      parseDeadline('Skicka in din ansökan och CV via Hankens ansökningssystem LAURA senast 4.10. 2026.', SEPT),
    ).toBe('2026-10-04');
    // "4.10. 2026" — the year is separated from the date by a space.
    expect(parseDeadline('Ansök senast söndagen den 4.10.2026', SEPT)).toBe('2026-10-04');
  });

  it('reads a listing header that states the hour as well', () => {
    expect(parseDeadline('Julkaistu 15.9. (Päättyy 4.10. klo 00:00)', SEPT)).toBe('2026-10-04');
    expect(deadlinePrefix(parseDeadline('Julkaistu 15.9. (Päättyy 4.10. klo 00:00)', SEPT))).toBe('1004');
  });

  it('still needs the bracket closed after whatever follows the date', () => {
    // The trailing run is what lets "klo 00:00" through; without the closing
    // bracket this is prose, and prose about dates is not a deadline.
    expect(parseDeadline('Julkaistu 15.9. Päättyy 4.10. klo 00:00', SEPT)).toBeUndefined();
  });

  it('does not let the gap wander off into a sentence', () => {
    // Two short words, not a clause: the date has to be nearly adjacent still.
    expect(parseDeadline('Apply before you forget to send us anything at all on 4.10.2026', SEPT)).toBeUndefined();
  });

  it('does not attach "mennessä" to a date it does not follow', () => {
    // The postposition governs the date immediately before it. A date elsewhere
    // in the sentence is somebody else's -- here, when the work starts.
    expect(parseDeadline('Työ alkaa 1.11.2026, ilmoita osallistumisesi hyvissä ajoin mennessä.', SEPT))
      .toBeUndefined();
  });

  it('reads a labelled date field, with slashes, day first', () => {
    expect(parseDeadline('Last application date: 02/10/2026', SEPT)).toBe('2026-10-02');
    expect(deadlinePrefix(parseDeadline('Last application date: 02/10/2026', SEPT))).toBe('1002');
    expect(parseDeadline('Last day to apply: 30/9/2026', SEPT)).toBe('2026-09-30');
    expect(parseDeadline('Closing date 30.9.2026', SEPT)).toBe('2026-09-30');
    expect(parseDeadline('Application deadline is 4/10', SEPT)).toBe('2026-10-04');
    expect(parseDeadline('Deadline for applications: 15.10.2026', SEPT)).toBe('2026-10-15');
  });

  it('reads "by the latest on <weekday> 20th of September"', () => {
    const text =
      'Please submit your CV and motivation letter in PDF format in Finnish or English by the latest on ' +
      'Sunday 20th of September via our application system.';
    expect(parseDeadline(text, SEPT)).toBe('2026-09-20');
    expect(parseDeadline('Apply no later than the 4th of October 2026', SEPT)).toBe('2026-10-04');
  });

  it('refuses a month-first date rather than guessing at it', () => {
    expect(parseDeadline('Last application date: 10/31/2026', SEPT)).toBeUndefined();
  });

  it('needs the labelled date directly after its label', () => {
    expect(parseDeadline('Deadline driven team; we shipped 2/10/2026 releases', SEPT)).toBeUndefined();
    expect(parseDeadline('Last application date: see 02/10/2026', SEPT)).toBeUndefined();
  });
});

describe('deadlinePrefix', () => {
  it('is MMDD', () => {
    expect(deadlinePrefix('2026-09-20')).toBe('0920');
    expect(deadlinePrefix('2027-03-11')).toBe('0311');
  });

  it('is empty when there is no deadline, so the title is unchanged', () => {
    expect(deadlinePrefix(undefined)).toBe('');
    expect(deadlinePrefix('')).toBe('');
    expect(deadlinePrefix('20.9.2026')).toBe('');
  });

  it('sorts by closing date when used as a title prefix', () => {
    const titles = ['2026-09-30', '2026-09-13', '2026-09-21'].map(
      (d) => `${deadlinePrefix(d)} Company — Role`,
    );
    expect([...titles].sort()).toEqual([
      '0913 Company — Role',
      '0921 Company — Role',
      '0930 Company — Role',
    ]);
  });
});

describe('parseOpenEnded', () => {
  it('recognises Duunitori stating no closing date', () => {
    // Duunitori writes this in the same slot where it otherwise puts
    // "haku päättyy 20.9.", so it is a known state, not a missing one.
    expect(parseOpenEnded('Rho Inc, Finland - Toistaiseksi voimassa')).toBe(true);
  });

  it('recognises English phrasings', () => {
    expect(parseOpenEnded('Applications accepted until further notice')).toBe(true);
    expect(parseOpenEnded('We hire on a rolling basis')).toBe(true);
    expect(parseOpenEnded('There is no application deadline')).toBe(true);
  });

  it('is false where the text simply says nothing about it', () => {
    expect(parseOpenEnded('If Insurance · Espoo, Uusimaa, Finland')).toBe(false);
    expect(parseOpenEnded('Academic Work | Tuusula, Helsinki | 12.09.2026')).toBe(false);
    expect(parseOpenEnded('')).toBe(false);
  });

  it('does not fire on a posting that states a date', () => {
    expect(parseOpenEnded('Steady Energy Oy, Espoo - haku päättyy 20.9.')).toBe(false);
  });
});

describe('postingTextUrl', () => {
  it('sends a LinkedIn posting to the guest endpoint', () => {
    // The job page is a 260 KB shell; the guest endpoint returns the posting,
    // description included, with no login. The "…more" button is CSS
    // truncation, so nothing is withheld from a fetch.
    expect(postingTextUrl('https://www.linkedin.com/jobs/view/4464157644')).toBe(
      'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4464157644',
    );
  });

  it('handles the /comm/ form the mails use', () => {
    expect(postingTextUrl('https://www.linkedin.com/comm/jobs/view/4464157644/?trackingId=x')).toBe(
      'https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4464157644',
    );
  });

  it('follows a link copied out of the jobs feed', () => {
    // These name the posting in a query parameter rather than the path. Left
    // alone, the fetch lands on the feed — half a megabyte saying nothing about
    // the posting — so an ad that had plainly ended came back unknown.
    expect(postingTextUrl('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=4434436969&discover=recommended'))
      .toBe('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4434436969');
    expect(postingTextUrl('https://www.linkedin.com/jobs/search-results/?currentJobId=4433813111&eBP=NOT_ELIGIBLE'))
      .toBe('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4433813111');
  });

  it('ignores a currentJobId that is not one', () => {
    // Only digits become a guest-endpoint id; anything else is left as the URL
    // it already was, rather than pasted into a path.
    expect(postingTextUrl('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=../etc'))
      .toBe('https://www.linkedin.com/jobs/collections/recommended/?currentJobId=../etc');
  });

  it('leaves other boards at their own URL', () => {
    const url = 'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347';
    expect(postingTextUrl(url)).toBe(url);
  });

  it('refuses anything that is not http', () => {
    expect(postingTextUrl('javascript:alert(1)')).toBeNull();
    expect(postingTextUrl('not a url')).toBeNull();
  });
});

/**
 * The import writes the closing date into the item's name, so reading it back
 * closes a great many items without asking a board anything — which is the only
 * thing that works when the board is refusing to answer. The prefix carries no
 * year, and that is the whole difficulty.
 */
describe('titleDeadline', () => {
  const SEPT15 = '2026-09-15T09:00:00.000Z';

  it('reads the prefix the import writes', () => {
    expect(titleDeadline('0920 Fennia — Product owner', SEPT15)).toBe('2026-09-20');
    expect(titleDeadline('0816 OP Senior Product Owner', SEPT15)).toBe('2026-08-16');
  });

  it('takes the nearest occurrence, not the most recent', () => {
    // "0920" in September means this month. Reaching for the last date that has
    // already passed would call a live ad closed by a year.
    expect(titleDeadline('0920 Something', SEPT15)).toBe('2026-09-20');
    expect(deadlinePassed(titleDeadline('0920 Something', SEPT15), SEPT15)).toBe(false);
  });

  it('crosses the new year the short way', () => {
    // Read in December, "0110" is three weeks off, not eleven months back.
    expect(titleDeadline('0110 Something', '2026-12-15T09:00:00.000Z')).toBe('2027-01-10');
    expect(titleDeadline('1220 Something', '2027-01-05T09:00:00.000Z')).toBe('2026-12-20');
  });

  it('ignores a name that merely starts with digits', () => {
    expect(titleDeadline('2026 budget planning', SEPT15)).toBeUndefined();
    expect(titleDeadline('1350 impossible month', SEPT15)).toBeUndefined();
    expect(titleDeadline('Product owner Fennia', SEPT15)).toBeUndefined();
    expect(titleDeadline('', SEPT15)).toBeUndefined();
  });

  it('agrees with the prefix the import would write', () => {
    const iso = '2026-09-20';
    expect(titleDeadline(`${deadlinePrefix(iso)} Something`, SEPT15)).toBe(iso);
  });
});

describe('deadlinePassed', () => {
  const NOW = '2026-09-15T09:00:00.000Z';

  it('is true for a date before today', () => {
    expect(deadlinePassed('2026-09-09', NOW)).toBe(true);
  });

  it('leaves the deadline day itself open', () => {
    // A posting closing at 16:00 is not shut at breakfast, and a date alone
    // cannot say when in the day it ends.
    expect(deadlinePassed('2026-09-15', NOW)).toBe(false);
  });

  it('is false for a date still to come, and for no date at all', () => {
    expect(deadlinePassed('2026-09-30', NOW)).toBe(false);
    expect(deadlinePassed(undefined, NOW)).toBe(false);
  });

  it('cannot fire on a deadline parsed without a year', () => {
    // parseDeadline resolves a bare "9.9." to the next occurrence, so a
    // year-less date is never in the past by construction.
    const parsed = parseDeadline('haku päättyy 9.9.', NOW);
    expect(parsed).toBe('2027-09-09');
    expect(deadlinePassed(parsed, NOW)).toBe(false);
  });
});

/**
 * Taken from the guest endpoint's real markup, open and closed. LinkedIn tells
 * a signed-out reader nothing in words about a posting it has stopped taking
 * applications for — no sentence, no status, no schema.org validThrough — but
 * it does stop rendering apply buttons into the top card's call-to-action
 * container. Both sides are quoted rather than tidied: the class names are the
 * whole signal.
 */
describe('linkedInApplyWithdrawn', () => {
  const container =
    '<div class="top-card-layout__cta-container flex flex-wrap mt-0.5 papabear:mt-0 ml-[-12px]">';
  const applyButton =
    '<button class="sign-up-modal__outlet top-card-layout__cta mt-2 ml-1.5 h-auto babybear:flex-auto ' +
    'top-card-layout__cta--primary btn-md btn-primary" data-modal="job-details-topcard-apply-modal"> Apply </button>';

  it('reads an empty call-to-action container as closed', () => {
    expect(linkedInApplyWithdrawn(`${container} <!----> <!----> </div>`)).toBe(true);
  });

  it('reads a posting that still offers Apply as open', () => {
    expect(linkedInApplyWithdrawn(`${container} ${applyButton} </div>`)).toBe(false);
  });

  it('says nothing when the top card is not there at all', () => {
    // A redirect, a sign-in wall, a rename of these classes: the rule falls
    // silent rather than calling every posting shut.
    expect(linkedInApplyWithdrawn('<html><body>Sign in to continue</body></html>')).toBe(false);
  });

  it('is asked only of the guest endpoint', () => {
    expect(isLinkedInGuest('https://www.linkedin.com/jobs-guest/jobs/api/jobPosting/4458065583')).toBe(true);
    expect(isLinkedInGuest('https://duunitori.fi/tyopaikat/tyo/ai-engineer-20567347')).toBe(false);
  });
});

describe('textFromHtml', () => {
  it('drops scripts and styles rather than reading them as prose', () => {
    const html = '<style>.a{color:red}</style><script>var deadline="1.1.2000"</script><p>haku päättyy 20.9.</p>';
    const text = textFromHtml(html);
    expect(text).toBe('haku päättyy 20.9.');
    expect(text).not.toContain('1.1.2000');
  });
});
