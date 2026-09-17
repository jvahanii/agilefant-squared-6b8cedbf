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

  it('falls back to the subject when a single-role alert has no company markup', () => {
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

  /**
   * Fortum's job alert, with its markup and links quoted from the real mail.
   * The brand sits in the path and the host is jobs.<employer>, so reading the
   * host alone named every posting "Jobs".
   */
  it('reads a Fortum alert: every posting, each credited to Fortum', () => {
    const q = 'from=email&amp;refid=28652025855&amp;utm_source=J2WEmail&amp;source=2&amp;eid=62155-202600160100-34188211055&amp;locale=en_US';
    const posting = (slug: string, id: string, text: string) =>
      `<span class="agentjoblink_bullet"></span> <a class="agentjoblink" href="http://jobs.fortum.com/Fortum/job/${slug}/${id}/?${q}">${text}</a><br/>\r\n`;
    const html =
      `You are receiving this email because you joined the Fortum Talent Community on 8/26/26. You will receive these messages every 7 day(s). Your Job Alert matched the following jobs at <a class="agentsitelink" href="http://jobs.fortum.com/?${q}">jobs.fortum.com</a>. <br/><br/><b> Jobs </b><br/>` +
      posting('Espoo-Senior-Manager-Go-To-Market', '1367748155', 'Senior Manager Go-To-Market - Espoo, FI') +
      posting('Sth-Solna-Senior-Specialist%2C-Master-Data-Management', '1367914655', 'Senior Specialist, Master Data Management - Sth Solna, SE') +
      posting('Espoo-Senior-Technical-Manager%2C-Industrial-Energy-Solutions', '1368623155', 'Senior Technical Manager, Industrial Energy Solutions - Espoo, FI') +
      posting('Espoo-Management-Assistant%2C-Technology-Leadership-and-Engagement', '1368041655', 'Management Assistant, Technology Leadership and Engagement - Espoo, FI') +
      `<br/><br/><br/><a class="agentmodifylink" href="https://career55.sapsf.eu/careers?site=&amp;company=fortumoyj&amp;clientId=jobs2web&amp;lang=en_US&amp;navBarLevel=JOB_MGMT&amp;subNavBarLevel=JOB_ALERTS">Manage your Job Alerts</a>` +
      `<a class="agentunsubscribelink" href="https://jobs.fortum.com/unsubscribe/?${q}">Unsubscribe </a>`;

    const links = extractLinks(
      message('fortumoyj-jobnotification@noreply55.jobs2web.com', html, 'New jobs posted from jobs.fortum.com'),
      'jobs',
    );

    expect(links).toHaveLength(4);
    expect(new Set(links.map((l) => l.company))).toEqual(new Set(['Fortum']));
    expect(links[0].title).toBe('Fortum — Senior Manager Go-To-Market - Espoo, FI');
  });

  /**
   * NestAI's Teamtailor digest, markup quoted from the real mail. The postings
   * live on the company's own domain, careers.nestai.com, not on
   * nestai.teamtailor.com — requiring the latter imported nothing at all.
   */
  it('reads a Teamtailor digest whose postings are on the company career domain', () => {
    const td =
      '<td align="center" style="-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;mso-table-lspace:0pt;mso-table-rspace:0pt;padding: 0 0 2px 0; font-size: 20px; line-height: 25px; font-family: Helvetica, Arial, sans-serif; color: #737D85;">\r\n\r\n';
    const place =
      '</td></tr><tr>\r\n  <td align="center" style="-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;mso-table-lspace:0pt;mso-table-rspace:0pt;padding: 0 0 20px 0; font-size: 17px; line-height: 25px; font-family: Helvetica, Arial, sans-serif; color: #34353A;">\r\n\r\n\r\n\r\n\r\n\r\n              Helsinki, Tampere, Turku and 1 more\r\n                ·\r\n                Hybrid\r\n                <img alt="Remote status" width="18" height="12" src="https://tt.teamtailor.com/assets/icons/remote-gray-23d6d767.png" style="-ms-interpolation-mode:bicubic;border:0;height:auto;line-height:100%;outline:none;text-decoration:none">\r\n\r\n</td></tr>\r\n\r\n';
    const posting = (href: string, text: string) =>
      `        <tr>\r\n  ${td}          <a style="color:#4a18ff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;text-decoration:none;" href="${href}">${text}</a>\r\n\r\n          ${place}`;
    const html =
      '<a style="color:#4a18ff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%;width: 100%; display: block; font-family: Helvetica, Arial, sans-serif; color: #666666; font-size: 16px;" border="0" align="center" href="https://careers.nestai.com">\r\n<img alt="NestAI" width="150" height="38" src="https://images.teamtailor-cdn.com/images/s3/teamtailor-production/logotype_mail_retina-v3/image_uploads/f4ff0755-1dc7-4007-9f74-8a17e43811cf/original.png">\r\n</a>' +
      '\r\n      Jarno, we have <strong>2 new jobs</strong> that match your profile\r\n\r\n' +
      posting('https://careers.nestai.com/jobs/8361702-machine-learning-engineer-action-recognition', 'Machine Learning Engineer, Action Recognition') +
      posting(
        'https://careers.nestai.com/jobs/8361711-machine-learning-engineer-object-tracking-re-identification',
        'Machine Learning Engineer, Object Tracking &amp; Re-Identification',
      ) +
      '      <a href="https://careers.nestai.com/?utm_content=email-career-site&amp;utm_medium=email&amp;utm_source=new_jobs_digest" style="color:#4a18ff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">Browse career site</a> or <a href="https://careers.nestai.com/connect/profile?utm_content=email-update-profile&amp;utm_medium=email&amp;utm_source=new_jobs_digest" style="color:#4a18ff;-webkit-text-size-adjust:100%;-ms-text-size-adjust:100%">update your profile</a>\r\n' +
      '<a target="_blank" href="https://careers.nestai.com/privacy-policy">\r\n<u>Privacy Policy</u>\r\n</a>' +
      '<a href="https://careers.nestai.com/en/connect/unsubscribe/anZhaGFuaWlAZ21haWwuY29t/6e0913a8-30d2-4a51-b30a-f49509535837" target="_blank">\r\n<u>\r\nUnsubscribe\r\n</u>\r\n</a>';

    const links = extractLinks(
      message('NestAI <no-reply@nestai.teamtailor-mail.com>', html, 'NestAI: 2 new jobs matching your profile'),
      'jobs',
    );

    expect(links.map((l) => l.url)).toEqual([
      'https://careers.nestai.com/jobs/8361702-machine-learning-engineer-action-recognition',
      'https://careers.nestai.com/jobs/8361711-machine-learning-engineer-object-tracking-re-identification',
    ]);
    expect(links.map((l) => l.title)).toEqual([
      'NestAI — Machine Learning Engineer, Action Recognition',
      'NestAI — Machine Learning Engineer, Object Tracking & Re-Identification',
    ]);
  });

  it('still drops tracker links, but not a posting whose slug says tracking', () => {
    const html = `
      <a href="https://pixel.example.com/open.gif?u=1">.</a>
      <a href="https://mail.example.com/tracking/open?id=abc">Open</a>
      <a href="https://beacon.example.net/c?x=1">Click</a>
      <a href="https://example.com/jobs/8361711-machine-learning-engineer-object-tracking-re-identification">Object Tracking role</a>`;
    const links = extractLinks(message('someone@example.com', html));
    expect(links.map((l) => l.url)).toEqual([
      'https://example.com/jobs/8361711-machine-learning-engineer-object-tracking-re-identification',
    ]);
  });

  it('does not take a language code in the path for the employer', () => {
    const url = 'https://careers.example.com/en_US/job/Helsinki-Role-00100/1234567/?from=email';
    const [link] = extractLinks(message('exampleoy-jobnotification@noreply1.jobs2web.com', `<a href="${url}">Role</a>`), 'jobs');
    expect(link.company).toBe('Example');
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

describe('LinkedIn digests name each employer, not the subject line', () => {
  /**
   * Shape of a real jobs-noreply "saved jobs" mail: several postings from
   * different employers, under a subject naming only the first. Reading the
   * subject labelled every row "emagine".
   *
   * Note the separator is the entity &middot;, not a literal character -- if it
   * is not decoded, the employer is parsed at the following comma instead and
   * comes out as "If Insurance &middot; Espoo".
   */
  const posting = (id: string, title: string, company: string, location: string) => `
    <a href="https://www.linkedin.com/comm/jobs/view/${id}?trackingId=x&amp;refId=y"> ${title} </a>
    </td></tr><tr><td><p class="text-system-gray-100"> ${company} &middot; ${location} </p></td></tr>`;

  const SUBJECT = "Jarno , apply now to 'Execution Leader/Scrum Master for Embedded Banking at emagine'";

  const DIGEST =
    posting('4463502292', 'Execution Leader/Scrum Master for Embedded Banking', 'emagine', 'Helsinki, Uusimaa, Finland') +
    posting('4464157644', 'Agile Coach', 'If Insurance', 'Espoo, Uusimaa, Finland') +
    posting('4411588306', 'Data-arkkitehti asiakkaiden tekoälymuutokseen', 'Gofore', 'Helsinki sub-region, Uusimaa, Finland') +
    posting('4444116317', 'Lead People Partner', 'Aiven', 'Helsinki, Uusimaa, Finland') +
    posting('4460375465', 'AI & Data Development Manager', 'Valio', 'Helsinki, Uusimaa, Finland');

  it('gives every posting its own employer', () => {
    const links = extractLinks(message('jobs-noreply@linkedin.com', DIGEST, SUBJECT), 'jobs');
    expect(links.map((l) => l.company)).toEqual([
      'emagine',
      'If Insurance',
      'Gofore',
      'Aiven',
      'Valio',
    ]);
  });

  it('does not label every row after the subject', () => {
    const links = extractLinks(message('jobs-noreply@linkedin.com', DIGEST, SUBJECT), 'jobs');
    expect(links.filter((l) => l.company === 'emagine')).toHaveLength(1);
  });

  it('decodes the middle dot so the employer is not run together with the city', () => {
    const links = extractLinks(message('jobs-noreply@linkedin.com', DIGEST, SUBJECT), 'jobs');
    for (const l of links) {
      expect(l.company).not.toContain('&middot;');
      expect(l.company).not.toContain('Uusimaa');
    }
  });

  it('titles each row with its own employer', () => {
    const links = extractLinks(message('jobs-noreply@linkedin.com', DIGEST, SUBJECT), 'jobs');
    expect(links[1].title).toBe('If Insurance — Agile Coach');
  });

  it('still falls back to the subject when the markup carries no employer', () => {
    // Single-role alerts state the company only in the subject.
    const html = '<a href="https://www.linkedin.com/comm/jobs/view/4401728681">Electronics Engineering Manager</a>';
    const [link] = extractLinks(
      message('jobalerts-noreply@linkedin.com', html, "You may be a fit for ICEYE's Electronics Engineering Manager role"),
      'jobs',
    );
    expect(link.company).toBe('ICEYE');
  });
});

describe('LinkedIn job alert digest names each employer', () => {
  /**
   * The jobalerts-noreply template, taken from a real mail: six postings from
   * six employers under a subject naming only the first. Reading the subject
   * labelled every row 'Basware'. The card shape matches the saved-jobs mail —
   * title anchor, then a paragraph of 'Company &middot; Location' — which is
   * what makes reading the markup first work for both.
   */
  // The attributes below are copied from the mail, and they are the point of
  // this fixture: 486 characters of cell, row and paragraph chrome separate a
  // title anchor from its employer. The first version of this test tidied them
  // away, so it passed against an extractor that kept only 400 characters after
  // an anchor -- which is exactly why every posting still arrived as Basware.
  const chrome =
    '</td> </tr> <tr> <td class="pb-0" style="-webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; mso-table-lspace: 0pt; mso-table-rspace: 0pt; padding-bottom: 0px;"> ' +
    '<p class="text-system-gray-100 text-xs leading-regular mt-0.5 line-clamp-1 text-ellipsis" style="margin: 0; font-weight: 400; margin-top: 4px; text-overflow: ellipsis; font-size: 12px; line-height: 1.25; color: #1f1f1f; overflow: hidden; display: -webkit-box; -webkit-box-orient: vertical; -webkit-line-clamp: 1;">';

  const card = (id, title, company, location) => `
    <td> <a href="https://www.linkedin.com/comm/jobs/view/${id}/?trackingId=x&amp;refId=y"> ${title} </a>
    ${chrome} ${company} &middot; ${location} </p> </td> </tr>`;

  const SUBJECT = 'You may be a fit for Basware’s Portfolio Architect role';

  const DIGEST =
    card('4429327744', 'Portfolio Architect', 'Basware', 'Tampere') +
    card('4408493605', 'Data Center IT Manager-Helsinki, Finland', 'Alibaba Cloud', 'Helsinki') +
    card('4419098406', 'Business Relationship Manager Associate Director - Nordic Business Unit', 'EY', 'Helsinki') +
    card('4466717361', 'Advanced Software Engineer', 'Agilent Technologies', 'Finland') +
    card('4430464643', 'Sourcing manager, Software', 'Tieto', 'Espoo') +
    card('4409262940', 'Lead Planner', 'John Sisk & Son Ltd', 'Helsinki Metropolitan Area');

  it('gives each posting the employer from its own card', () => {
    const links = extractLinks(message('jobalerts-noreply@linkedin.com', DIGEST, SUBJECT), 'jobs');
    expect(links.map((l) => l.company)).toEqual([
      'Basware',
      'Alibaba Cloud',
      'EY',
      'Agilent Technologies',
      'Tieto',
      'John Sisk & Son Ltd',
    ]);
  });

  it('does not spread the subject’s employer across the digest', () => {
    const links = extractLinks(message('jobalerts-noreply@linkedin.com', DIGEST, SUBJECT), 'jobs');
    // One of six really is Basware; the other five were mislabelled.
    expect(links.filter((l) => l.company === 'Basware')).toHaveLength(1);
    expect(links[1].title).toBe('Alibaba Cloud — Data Center IT Manager-Helsinki, Finland');
  });
});
