import { describe, it, expect } from 'vitest';
import {
  parseDeadline,
  deadlinePrefix,
  parseOpenEnded,
  parseApplicationsClosed,
} from '../../supabase/functions/_shared/deadlines';
import {
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

describe('textFromHtml', () => {
  it('drops scripts and styles rather than reading them as prose', () => {
    const html = '<style>.a{color:red}</style><script>var deadline="1.1.2000"</script><p>haku päättyy 20.9.</p>';
    const text = textFromHtml(html);
    expect(text).toBe('haku päättyy 20.9.');
    expect(text).not.toContain('1.1.2000');
  });
});
