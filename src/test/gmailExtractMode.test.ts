import { describe, it, expect } from 'vitest';
import { extractLinks, type GmailMessage } from '../../supabase/functions/_shared/extract';

/**
 * The job-ad import and the generic link import share one extractor, separated
 * only by mode. These tests exist to keep that separation honest: the generic
 * path must behave exactly as it did before job support was added, whoever the
 * sender happens to be.
 */

function message(from: string, html: string, subject = "Duunitori löysi sinulle 2 työpaikkaa"): GmailMessage {
  return {
    id: 'msg-1',
    internalDate: '1789255235000',
    payload: {
      mimeType: 'text/html',
      body: { data: Buffer.from(html, 'utf8').toString('base64url') },
      headers: [
        { name: 'From', value: from },
        { name: 'Subject', value: subject },
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

/**
 * Item naming. Structures below are trimmed copies of the real digests, so a
 * board changing its markup fails these rather than silently degrading titles.
 */
describe('work item naming: company then title', () => {
  const JOB = 'https://www.jobly.fi/tyopaikka/ops-specialist-tuusula-helsinki-2734734';

  it('reads the employer from the paragraph after the title anchor (Jobly)', () => {
    const html = `
      <a href="${JOB}"><img src="https://www.jobly.fi/logo.png"></a>
      <p class="job_title_text"><a href="${JOB}" class="link">OPS Specialist, Tuusula/Helsinki</a></p>
      <p class="job_text"><span class="company-name">Academic Work</span> | Tuusula, Helsinki | 12.09.2026</p>`;
    const [link] = extractLinks(message('noreply@jobly.fi', html), 'jobs');
    expect(link.company).toBe('Academic Work');
    expect(link.title).toBe('Academic Work — OPS Specialist, Tuusula/Helsinki');
  });

  it('does not mistake the logo anchor for the title anchor', () => {
    // The logo link comes first and its following markup is the job title. A
    // naive "first occurrence" read names every item after its own title.
    const html = `
      <a href="${JOB}"><img src="https://www.jobly.fi/logo.png"></a>
      <p class="job_title_text"><a href="${JOB}" class="link">OPS Specialist, Tuusula/Helsinki</a></p>
      <p class="job_text"><span class="company-name">Academic Work</span> | Tuusula</p>`;
    const [link] = extractLinks(message('noreply@jobly.fi', html), 'jobs');
    expect(link.company).not.toBe('OPS Specialist');
    expect(link.title).not.toMatch(/^OPS Specialist — /);
  });

  it('reads the employer from the row below the title (Duunitori)', () => {
    const url = 'https://duunitori.fi/tyopaikat/tyo/junior-data-software-specialist-espoo-sasca-20564911';
    const html = `
      <a href="${url}"><img src="https://duunitori.fi/logo.png"></a>
      <a class="dark-white" href="${url}"> Junior Data &amp; Software Specialist, Espoo </a>
      </td></tr><tr><td class="dark-gray"><u></u> Academic Work, Espoo - Hakuaika 11.9 - 11.3. <u></u></td></tr>`;
    const [link] = extractLinks(message('duunivahti@duunitori.fi', html), 'jobs');
    expect(link.company).toBe('Academic Work');
    expect(link.title).toBe('Academic Work — Junior Data & Software Specialist, Espoo');
  });

  it('takes the employer from the subject on LinkedIn', () => {
    const url = 'https://www.linkedin.com/comm/jobs/view/4401728681/?trackingId=x';
    const html = `<a href="${url}">Electronics Engineering Manager, Radar Payload Team</a>`;
    const [link] = extractLinks(
      message('jobalerts-noreply@linkedin.com', html, 'You may be a fit for ICEYE’s Electronics Engineering Manager role'),
      'jobs',
    );
    expect(link.company).toBe('ICEYE');
  });

  it('takes the second of The Hub’s per-field links', () => {
    const url = 'https://thehub.io/jobs/6aa0e558dc6b58d5a066459d';
    const html = `
      <a href="${url}">Account Executive</a>
      <a href="${url}">JohTo Partners Oy</a>
      <a href="${url}">Helsinki</a>`;
    const [link] = extractLinks(message('noreply@thehub.io', html), 'jobs');
    expect(link.company).toBe('JohTo Partners Oy');
    expect(link.title).toBe('JohTo Partners Oy — Account Executive');
  });

  it('takes the employer from the career-site host on jobs2web', () => {
    const url = 'http://careers.nordea.com/job/Helsinki-AI-Platform-Engineer-00500/1382818133/?from=email';
    const html = `<a href="${url}">AI Platform Engineer - Helsinki, FI, 00500</a>`;
    const [link] = extractLinks(message('nordeabank-jobnotification@noreply12.jobs2web.com', html), 'jobs');
    expect(link.company).toBe('Nordea');
  });

  it('does not repeat a company the title already names', () => {
    const url = 'https://thehub.io/jobs/6aa0e558dc6b58d5a066459d';
    const html = `
      <a href="${url}">Verda Platform Engineer</a>
      <a href="${url}">Verda</a>`;
    const [link] = extractLinks(message('noreply@thehub.io', html), 'jobs');
    expect(link.title).toBe('Verda Platform Engineer');
  });

  it('leaves generic mode titles alone', () => {
    const html = `
      <a href="${JOB}"><img src="https://www.jobly.fi/logo.png"></a>
      <p><a href="${JOB}">OPS Specialist, Tuusula/Helsinki</a></p>
      <p><span class="company-name">Academic Work</span> | Tuusula</p>`;
    const [link] = extractLinks(message('noreply@jobly.fi', html));
    expect(link.company).toBeUndefined();
    expect(link.title).toBe('OPS Specialist, Tuusula/Helsinki');
  });
});
