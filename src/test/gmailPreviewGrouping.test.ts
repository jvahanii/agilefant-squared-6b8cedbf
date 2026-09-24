import { describe, it, expect } from 'vitest';
import {
  deadlineLabel,
  senderName,
  senderAddress,
  gmailMessageUrl,
  groupBySourceEmail,
  previewSummary,
  uncheckedReason,
  repeatedRows,
  startingReason,
  distinctJobs,
  rowKey,
  alreadyInSummary,
  keptCopies,
  repeatedElsewhere,
  alsoInLabel,
} from '@/lib/gmailPreview';

/**
 * The import picker groups postings under the email they came from. A digest
 * contributes a dozen rows at once, and without the grouping they arrive as a
 * flat list with no indication of where any of them came from.
 */

const link = (messageId: string, url: string, title: string, subject: string, from: string) => ({
  url,
  title,
  messageId,
  subject,
  from,
  date: '2026-09-13T07:22:04.000Z',
  alreadyImported: false,
});

describe('senderName', () => {
  it('prefers the display name', () => {
    expect(senderName('Duunitori <duunivahti@duunitori.fi>')).toBe('Duunitori');
  });

  it('falls back to the address when there is no display name', () => {
    expect(senderName('noreply@jobly.fi')).toBe('noreply@jobly.fi');
    expect(senderName('<noreply@jobly.fi>')).toBe('noreply@jobly.fi');
  });

  it('strips quoting around a display name', () => {
    expect(senderName('"Jobly, Oy" <noreply@jobly.fi>')).toBe('Jobly, Oy');
  });
});

describe('gmailMessageUrl', () => {
  it('points at the message in Gmail', () => {
    expect(gmailMessageUrl('1a099a509a613101')).toBe(
      'https://mail.google.com/mail/u/0/#all/1a099a509a613101',
    );
  });
});

describe('groupBySourceEmail', () => {
  const jobly1 = link('m1', 'https://jobly.fi/tyopaikka/a-1', 'A', 'Jobly: 3 new', 'noreply@jobly.fi');
  const jobly2 = link('m1', 'https://jobly.fi/tyopaikka/b-2', 'B', 'Jobly: 3 new', 'noreply@jobly.fi');
  const duuni = link('m2', 'https://duunitori.fi/tyopaikat/tyo/c-3', 'C', 'Duunitori: 1 new', 'duunivahti@duunitori.fi');

  it('puts postings from one email under one heading', () => {
    const groups = groupBySourceEmail([jobly1, jobly2, duuni]);
    expect(groups).toHaveLength(2);
    expect(groups[0].messageId).toBe('m1');
    expect(groups[0].links).toHaveLength(2);
    expect(groups[1].links).toHaveLength(1);
  });

  it('carries the heading fields the picker shows', () => {
    const [g] = groupBySourceEmail([jobly1, jobly2]);
    expect(g.subject).toBe('Jobly: 3 new');
    expect(g.from).toBe('noreply@jobly.fi');
    expect(g.date).toBe('2026-09-13T07:22:04.000Z');
  });

  it('keeps the order links arrived in', () => {
    // Newest-first ordering is decided upstream; grouping must not reshuffle it.
    const groups = groupBySourceEmail([duuni, jobly1, jobly2]);
    expect(groups.map((g) => g.messageId)).toEqual(['m2', 'm1']);
  });

  it('regroups interleaved rows without losing any', () => {
    const groups = groupBySourceEmail([jobly1, duuni, jobly2]);
    expect(groups.map((g) => g.messageId)).toEqual(['m1', 'm2']);
    expect(groups.flatMap((g) => g.links)).toHaveLength(3);
  });

  it('labels a missing subject rather than showing nothing', () => {
    const [g] = groupBySourceEmail([link('m9', 'https://x/y', 'T', '', 'a@b.c')]);
    expect(g.subject).toBe('(no subject)');
  });

  it('handles an empty preview', () => {
    expect(groupBySourceEmail([])).toEqual([]);
  });
});

describe('previewSummary', () => {
  it('counts jobs and the emails they came from', () => {
    expect(previewSummary({ shown: 12, emails: 3, mode: 'jobs' })).toBe(
      '12 jobs found in 3 emails — pick what to import',
    );
  });

  it('says how many seem new', () => {
    expect(previewSummary({ shown: 12, emails: 3, mode: 'jobs', fresh: 5 })).toBe(
      '12 jobs, out of which 5 seem new, found in 3 emails — pick what to import',
    );
    expect(previewSummary({ shown: 12, emails: 3, mode: 'jobs', fresh: 1 })).toContain(
      'out of which 1 seems new,',
    );
    expect(previewSummary({ shown: 3, emails: 1, mode: 'jobs', total: 12, fresh: 0 })).toBe(
      '3 jobs, out of which 0 seem new, found in 1 email (filtered from 12) — pick what to import',
    );
  });

  it('uses singulars where they belong', () => {
    expect(previewSummary({ shown: 1, emails: 1, mode: 'jobs' })).toBe(
      '1 job found in 1 email — pick what to import',
    );
  });

  it('says links for the generic import', () => {
    expect(previewSummary({ shown: 7, emails: 2, mode: 'links' })).toContain('7 links found in 2 emails');
  });

  it('shows what the keyword filter hid', () => {
    expect(previewSummary({ shown: 3, emails: 1, mode: 'jobs', total: 12 })).toBe(
      '3 jobs found in 1 email (filtered from 12) — pick what to import',
    );
  });

  it('stays quiet when the filter hid nothing', () => {
    expect(previewSummary({ shown: 12, emails: 3, mode: 'jobs', total: 12 })).not.toContain('filtered');
  });

  it('handles an empty result', () => {
    expect(previewSummary({ shown: 0, emails: 0, mode: 'jobs' })).toBe(
      '0 jobs found in 0 emails — pick what to import',
    );
  });
});

describe('senderAddress', () => {
  it('returns the address when a display name is present', () => {
    expect(senderAddress('Duunitori <duunivahti@duunitori.fi>')).toBe('duunivahti@duunitori.fi');
  });

  it('is empty for a bare address, which senderName already shows', () => {
    // Otherwise the picker prints "noreply@jobly.fi <noreply@jobly.fi>".
    expect(senderAddress('noreply@jobly.fi')).toBe('');
    expect(senderAddress('<noreply@thehub.io>')).toBe('');
  });

  it('handles a quoted display name containing a comma', () => {
    expect(senderAddress('"Jobly, Oy" <noreply@jobly.fi>')).toBe('noreply@jobly.fi');
  });

  it('pairs with senderName without repeating the address', () => {
    const from = 'Duunitori <duunivahti@duunitori.fi>';
    expect(senderName(from)).toBe('Duunitori');
    expect(senderAddress(from)).not.toBe(senderName(from));
  });
});

describe('deadlineLabel', () => {
  it('says a closed posting is closed, whatever date it carried', () => {
    expect(deadlineLabel({ applicationsClosed: true })).toBe('no longer accepting applications');
    // The date is moot once nobody can apply, so it does not win here.
    expect(deadlineLabel({ deadline: '2026-09-30', applicationsClosed: true }))
      .toBe('no longer accepting applications');
  });

  it('still reports a deadline, an open posting, and an unknown one', () => {
    expect(deadlineLabel({ deadline: '2026-09-30' })).toContain('closes');
    expect(deadlineLabel({ deadlineOpen: true })).toBe('open until further notice');
    expect(deadlineLabel({})).toBe('deadline unknown');
  });
});

/**
 * An unticked row with no reason on it looks like a mistake, so the picker
 * unticks a row only for a reason this function can name.
 */
describe('uncheckedReason', () => {
  const NOW = new Date('2026-09-17T09:00:00Z');

  it('names every reason the picker unticks a row for', () => {
    expect(uncheckedReason({ alreadyImported: true, alreadyIn: 'Ei ehtinyt hakea' }, NOW)).toBe(
      'already in Ei ehtinyt hakea',
    );
    expect(uncheckedReason({ alreadyImported: true }, NOW)).toBe('already imported');
    expect(uncheckedReason({ applicationsClosed: true }, NOW)).toBe('no longer accepting applications');
    expect(uncheckedReason({ deadline: '2026-09-16' }, NOW)).toBe('the closing date has passed');
  });

  it('leaves a posting that can still be applied for ticked', () => {
    expect(uncheckedReason({}, NOW)).toBeNull();
    expect(uncheckedReason({ deadline: '2026-09-30' }, NOW)).toBeNull();
    // Today is not too late.
    expect(uncheckedReason({ deadline: '2026-09-17' }, NOW)).toBeNull();
  });

  it('prefers the reason that says most: where it already is', () => {
    expect(uncheckedReason({ alreadyImported: true, alreadyIn: 'Applied', applicationsClosed: true }, NOW)).toBe(
      'already in Applied',
    );
  });
});

describe('repeatedRows', () => {
  const rows = [
    link('m-new', 'https://x/a', 'A', 'Newest alert', 'LinkedIn'),
    link('m-new', 'https://x/b', 'B', 'Newest alert', 'LinkedIn'),
    link('m-new', 'https://x/a', 'A again', 'Newest alert', 'LinkedIn'),
    link('m-old', 'https://x/a', 'A', 'Older digest', 'Nordea'),
    link('m-old', 'https://x/c', 'C', 'Older digest', 'Nordea'),
  ];

  it('keeps the first copy of a posting and names where it was first', () => {
    const repeats = repeatedRows(rows);
    expect(repeats.size).toBe(1);
    expect(repeats.get(rowKey(rows[0]))).toBeUndefined();
    expect(repeats.get(rowKey(rows[3]))).toBe('also in "Newest alert"');
  });

  it('leaves a posting listed twice in one email ticked', () => {
    // Same row key as the first copy: marking it would untick that one too.
    expect(repeatedRows(rows).get(rowKey(rows[2]))).toBeUndefined();
  });

  it('counts each posting once', () => {
    expect(distinctJobs(rows)).toBe(3);
  });

  it('puts the row’s own reason before being a repeat', () => {
    const seen = [
      { ...rows[0], alreadyImported: true, alreadyIn: 'Applied' },
      { ...rows[3], alreadyImported: true, alreadyIn: 'Applied' },
    ];
    const repeats = repeatedRows(seen);
    expect(startingReason(seen[1], repeats)).toBe('already in Applied');
    expect(startingReason(rows[1], repeatedRows(rows))).toBeNull();
  });
});

describe('folding a posting that several emails carried', () => {
  const rows = [
    link('m-new', 'https://x/a', 'A', 'Newest alert', 'LinkedIn'),
    link('m-new', 'https://x/b', 'B', 'Newest alert', 'LinkedIn'),
    link('m-new', 'https://x/a', 'A again', 'Newest alert', 'LinkedIn'),
    link('m-old', 'https://x/a', 'A', 'Older digest', 'Nordea'),
    link('m-old', 'https://x/c', 'C', 'Older digest', 'Nordea'),
  ];

  it('keeps one row per posting, whichever email it came from', () => {
    const kept = keptCopies(rows);
    const shown = rows.filter((l) => kept.get(l.url) === l);
    // Three postings, five rows: the second copy of A in the same email and the
    // copy in the older digest both fold away.
    expect(shown).toHaveLength(3);
    expect(shown.map((l) => l.url)).toEqual(['https://x/a', 'https://x/b', 'https://x/c']);
    expect(shown[0].messageId).toBe('m-new');
  });

  it('tells the kept row how many other emails carried it, and which', () => {
    const also = repeatedElsewhere(rows);
    expect(also.get(rowKey(rows[0]))).toEqual({ count: 1, subjects: ['Older digest'] });
    // A posting only one email carried has nothing to say.
    expect(also.has(rowKey(rows[1]))).toBe(false);
  });

  it('does not count a second copy inside the same email as another email', () => {
    // rows[2] is A again, in m-new — the kept row's own email.
    expect(repeatedElsewhere(rows).get(rowKey(rows[0]))!.count).toBe(1);
  });

  it('counts emails rather than subjects, since alerts repeat a subject', () => {
    const repeated = [
      link('m-1', 'https://x/a', 'A', 'New jobs similar to Analyst', 'LinkedIn'),
      link('m-2', 'https://x/a', 'A', 'New jobs similar to Analyst', 'LinkedIn'),
      link('m-3', 'https://x/a', 'A', 'New jobs similar to Analyst', 'LinkedIn'),
    ];
    const entry = repeatedElsewhere(repeated).get(rowKey(repeated[0]))!;
    expect(entry.count).toBe(2);
    // One subject worth showing, two emails behind it.
    expect(entry.subjects).toEqual(['New jobs similar to Analyst']);
  });

  it('folds towards the copy that states a closing date', () => {
    const undated = link('m-new', 'https://x/a', 'A', 'Newest alert', 'LinkedIn');
    const dated = { ...link('m-old', 'https://x/a', 'A', 'Older digest', 'Nordea'), deadline: '2026-10-11' };
    const kept = keptCopies([undated, dated]);
    expect(kept.get('https://x/a')).toBe(dated);
    expect(repeatedElsewhere([undated, dated]).get(rowKey(dated))).toEqual({
      count: 1,
      subjects: ['Newest alert'],
    });
  });

  it('says it in words', () => {
    expect(alsoInLabel(1)).toBe('also in 1 other email');
    expect(alsoInLabel(3)).toBe('also in 3 other emails');
  });
});

describe('repeatedRows with a closing date on one copy', () => {
  const undated = link('m-new', 'https://x/a', 'A', 'Newest alert', 'LinkedIn');
  const dated = { ...link('m-old', 'https://x/a', 'A', 'Older digest', 'Nordea'), deadline: '2026-10-11' };
  const laterDated = { ...link('m-oldest', 'https://x/a', 'A', 'Oldest', 'Duunitori'), deadline: '2026-10-12' };

  it('keeps the copy that states a closing date', () => {
    const repeats = repeatedRows([undated, dated, laterDated]);
    expect(repeats.get(rowKey(dated))).toBeUndefined();
    expect(repeats.get(rowKey(undated))).toBe('also in "Older digest"');
    // Of two dated copies, the newer one.
    expect(repeats.get(rowKey(laterDated))).toBe('also in "Older digest"');
  });
});

describe('alreadyInSummary', () => {
  const row = (alreadyIn: string | null, alreadyImported = true) => ({ alreadyImported, alreadyIn });

  it('names the lists the jobs are already in', () => {
    expect(alreadyInSummary([row('Jobs with no deadline'), row('Jobs with no deadline')])).toBe(
      '2 already in Jobs with no deadline',
    );
    expect(alreadyInSummary([row('Jobs with no deadline'), row('Jobs with deadline'), row('Jobs with no deadline')])).toBe(
      '2 already in Jobs with no deadline, 1 in Jobs with deadline',
    );
  });

  it('says only "imported" when a row does not name its list, and nothing when none are', () => {
    expect(alreadyInSummary([row('Applied'), row(null)])).toBe('2 already imported');
    expect(alreadyInSummary([row(null, false)])).toBe('');
  });
});

describe('cityLine', () => {
  it('keeps a long list to two cities and a count', async () => {
    const { cityLine } = await import('@/lib/gmailPreview');
    expect(cityLine(['Helsinki'])).toBe('Helsinki');
    expect(cityLine(['Helsinki', 'Joensuu'])).toBe('Helsinki, Joensuu');
    expect(
      cityLine(['Helsinki', 'Joensuu', 'Jyväskylä', 'Kuopio', 'Lappeenranta', 'Oulu', 'Rovaniemi', 'Seinäjoki', 'Tampere', 'Turku']),
    ).toBe('Helsinki, Joensuu +8 more');
  });
});
