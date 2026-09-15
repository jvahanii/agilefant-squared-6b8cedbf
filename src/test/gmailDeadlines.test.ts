import { describe, it, expect } from 'vitest';
import {
  parseDeadline,
  deadlinePrefix,
  deadlinePassed,
  parseOpenEnded,
  parseApplicationsClosed,
} from '../../supabase/functions/_shared/deadlines';
import {
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

  it('says nothing about a posting that is still open', () => {
    expect(parseApplicationsClosed('Apply by 30.9. — we are accepting applications')).toBe(false);
    expect(parseApplicationsClosed('Over 100 people clicked apply')).toBe(false);
    expect(parseApplicationsClosed('')).toBe(false);
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

  it('does not attach "mennessä" to a date it does not follow', () => {
    // The postposition governs the date immediately before it. A date elsewhere
    // in the sentence is somebody else's -- here, when the work starts.
    expect(parseDeadline('Työ alkaa 1.11.2026, ilmoita osallistumisesi hyvissä ajoin mennessä.', SEPT))
      .toBeUndefined();
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

  it('leaves other boards at their own URL', () => {
    const url = 'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347';
    expect(postingTextUrl(url)).toBe(url);
  });

  it('refuses anything that is not http', () => {
    expect(postingTextUrl('javascript:alert(1)')).toBeNull();
    expect(postingTextUrl('not a url')).toBeNull();
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
