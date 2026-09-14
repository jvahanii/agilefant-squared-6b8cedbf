import { describe, it, expect } from 'vitest';
import {
  senderName,
  gmailMessageUrl,
  groupBySourceEmail,
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
