import { describe, it, expect } from 'vitest';
import { extractLinks, type GmailMessage } from '../../supabase/functions/_shared/extract';

/**
 * The job-ad import and the generic link import share one extractor, separated
 * only by mode. These tests exist to keep that separation honest: the generic
 * path must behave exactly as it did before job support was added, whoever the
 * sender happens to be.
 */

function message(from: string, html: string): GmailMessage {
  return {
    id: 'msg-1',
    internalDate: '1789255235000',
    payload: {
      mimeType: 'text/html',
      body: { data: Buffer.from(html, 'utf8').toString('base64url') },
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: 'Duunitori löysi sinulle 2 työpaikkaa' },
      ],
    },
  };
}

// A cut-down Duunitori digest: two postings wrapped in the usual furniture.
const DIGEST = `
  <a href="https://duunitori.fi/paikkavahti/697346aa/nayta">Avaa viesti selaimessa</a>
  <a href="https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347?identity_token=abc">AI Engineer</a>
  <a href="https://duunitori.fi/tyopaikat/tyo/specialist-paid-social-scsom-20567401">Specialist, Paid Social</a>
  <a href="https://duunitori.fi/tyoelama/cv-mokat">Lue lisää</a>
  <a href="https://duunitori.fi/paikkavahti/697346aa/muokkaa">Muokkaa Duunivahtia</a>
`;

const FROM = 'Duunitori <duunivahti@duunitori.fi>';

describe('extractLinks mode', () => {
  it('defaults to the generic behaviour: every link, job sender or not', () => {
    const links = extractLinks(message(FROM, DIGEST));
    expect(links.length).toBe(5);
    expect(links.some((l) => l.url.includes('/paikkavahti/'))).toBe(true);
    expect(links.some((l) => l.url.includes('/tyoelama/'))).toBe(true);
  });

  it('is unchanged when links mode is passed explicitly', () => {
    const implicit = extractLinks(message(FROM, DIGEST)).map((l) => l.url);
    const explicit = extractLinks(message(FROM, DIGEST), 'links').map((l) => l.url);
    expect(explicit).toEqual(implicit);
  });

  it('returns only postings in jobs mode', () => {
    const links = extractLinks(message(FROM, DIGEST), 'jobs');
    expect(links.map((l) => l.url)).toEqual([
      'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347',
      'https://duunitori.fi/tyopaikat/tyo/specialist-paid-social-scsom-20567401',
    ]);
  });

  it('keeps the anchor text as the work item title', () => {
    const links = extractLinks(message(FROM, DIGEST), 'jobs');
    expect(links.map((l) => l.title)).toEqual(['AI Engineer', 'Specialist, Paid Social']);
  });

  it('returns nothing in jobs mode for a sender with no job profile', () => {
    const html = '<a href="https://example.com/thing">Thing</a>';
    expect(extractLinks(message('someone@example.com', html), 'jobs')).toHaveLength(1);
  });
});
