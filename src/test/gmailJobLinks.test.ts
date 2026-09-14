import { describe, it, expect } from 'vitest';
import { normalizeUrl } from '../../supabase/functions/_shared/urls';
import {
  filterJobLinks,
  canonicalizeByHost,
  defaultJobQuery,
  JOB_SOURCES,
} from '../../supabase/functions/_shared/jobSources';

// Every URL below is taken verbatim from real job-alert mail, so these tests
// fail if a board changes its link shape rather than only if the code changes.

const JOBLY_MANDRILL =
  'https://mandrillapp.com/track/click/30900652/www.jobly.fi?p=eyJzIjoiaW4xWUhaUUVwY093d1ZXNW1KMnJueEVQNERVIiwidiI6MiwicCI6IntcInVcIjozMDkwMDY1MixcInZcIjoyLFwidXJsXCI6XCJodHRwczpcXFwvXFxcL3d3dy5qb2JseS5maVxcXC90eW9wYWlra2FcXFwvb3BzLXNwZWNpYWxpc3QtdHV1c3VsYS1oZWxzaW5raS0yNzM0NzM0P3NvdXJjZT1qb2JfYWxlcnQmYW1wO3V0bV9zb3VyY2U9am9iX2FsZXJ0JmFtcDt1dG1fbWVkaXVtPWVtYWlsJmFtcDt1dG1fY2FtcGFpZ249am9iX2FsZXJ0JnV0bV9jb250ZW50PWpvYl9sb2dvXCIsXCJpZFwiOlwiMGNjYWQ5OGVmNWViNDY0Y2FhOWE0YTQ5Zjc4YTNjOWNcIixcInVybF9pZHNcIjpbXCJhZGFkNzUzY2IxYWM4ZjlhOTRiZDZjYzQ2MDVkNmEzZTdlMWQwMThmXCJdLFwibXNnX3RzXCI6MTc4OTI4NDEyNH0ifQ';

const DUUNITORI_JOB =
  'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347?utm_source=Tyopaikkavahti&utm_medium=email&utm_campaign=Tyopaikkavahti&frequency=instantly&identity_token=eyJhbGciOiJIUzI1NiJ9.eyJlbWFpbCI6Imp2YWhhbmlpQGdtYWlsLmNvbSJ9.sig';

const LINKEDIN_JOB =
  'https://www.linkedin.com/comm/jobs/view/4401728681/?trackingId=tbCugiwvNxteCV5OogfTIQ%3D%3D&refId=p0IiKL9rZeLqNShNTRTecw%3D%3D&lipi=urn%3Ali%3Apage%3Aemail_email_job_alert_digest_01&midToken=AQEgKAHVo1dXQg&midSig=1jMnXmLQc22Is1&trk=eml-primary_job_list-0&otpToken=NDdhODNi';

const norm = (u: string) => normalizeUrl(u)!;
const pipeline = (from: string, urls: string[]) =>
  filterJobLinks(
    from,
    urls.map((u) => ({ url: normalizeUrl(u) ?? u })),
  ).map((l) => l.url);

describe('normalizeUrl: tracking wrappers', () => {
  it('unwraps a Mandrill-wrapped Jobly link to the posting itself', () => {
    expect(norm(JOBLY_MANDRILL)).toBe('https://www.jobly.fi/tyopaikka/ops-specialist-tuusula-helsinki-2734734?source=job_alert');
  });

  it('unwraps a Mandrill-wrapped The Hub link', () => {
    const wrapped =
      'https://mandrillapp.com/track/click/30849079/thehub.io?p=eyJzIjoiNlNyWlpzY1JsRHc2NW5pc2RCaDd4TVJ5bDJFIiwidiI6MiwicCI6IntcInVcIjozMDg0OTA3OSxcInZcIjoyLFwidXJsXCI6XCJodHRwczpcXFwvXFxcL3RoZWh1Yi5pb1xcXC9qb2JzXFxcLzZhYTBlNTU4ZGM2YjU4ZDVhMDY2NDU5ZD91dG1fbWVkaXVtPWVtYWlsJmFtcDt1dG1fc291cmNlPWRpZ2VzdFwiLFwiaWRcIjpcImEzNjhhMWZiOWI5ZjQ3Mjk5Y2NiNGFjNThlYjc1OTFkXCIsXCJ1cmxfaWRzXCI6W1wiNGFmMTY5MWNhN2IzNGJiNzBjM2MxNzRhMTBiN2Q5MjgxNjA5MzgzOFwiXSxcIm1zZ190c1wiOjE3ODkyNzIyNzd9In0';
    expect(norm(wrapped)).toBe('https://thehub.io/jobs/6aa0e558dc6b58d5a066459d');
  });

  it('does not leak the recipient email held in Duunitori identity_token', () => {
    const out = norm(DUUNITORI_JOB);
    expect(out).not.toContain('identity_token');
    expect(out).not.toContain('jvahanii');
  });

  it('leaves an ordinary link alone', () => {
    expect(norm('https://example.com/a/b?keep=1')).toBe('https://example.com/a/b?keep=1');
  });
});

describe('job links: one posting, one URL', () => {
  it('collapses LinkedIn resends of the same role', () => {
    // LinkedIn re-sends an alert up to five times a day, with fresh tracking
    // ids each time. Without collapsing these the backlog fills with copies.
    const send1 = LINKEDIN_JOB;
    const send2 = LINKEDIN_JOB.replace('tbCugiwvNxteCV5OogfTIQ%3D%3D', 'ZZZdifferentZZZ%3D%3D').replace(
      'p0IiKL9rZeLqNShNTRTecw%3D%3D',
      'QQQdifferentQQQ%3D%3D',
    );
    const out = pipeline('jobalerts-noreply@linkedin.com', [send1, send2]);
    expect(out).toEqual(['https://www.linkedin.com/jobs/view/4401728681']);
  });

  it('folds the email-only /comm/ prefix into the canonical path', () => {
    const [out] = pipeline('jobs-noreply@linkedin.com', [LINKEDIN_JOB]);
    expect(out).toBe('https://www.linkedin.com/jobs/view/4401728681');
  });
});

describe('job links: digest chrome is dropped', () => {
  it('keeps postings and discards navigation and editorial', () => {
    // Shape of a real "6 new jobs" Duunitori mail.
    const out = pipeline('duunivahti@duunitori.fi', [
      'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347?identity_token=abc',
      'https://duunitori.fi/tyopaikat/tyo/specialist-paid-social-scsom-20567401',
      'https://duunitori.fi/paikkavahti/697346aa/nayta',          // open in browser
      'https://duunitori.fi/tyopaikat?haku=agile%3Bai',           // browse all
      'https://duunitori.fi/tyoelama/cv-mokat',                   // editorial
      'https://duunitori.fi/tyoelama/',                           // editorial index
      'https://duunitori.fi/paikkavahti/697346aa/muokkaa',        // edit alert
      'https://duunitori.fi/paikkavahti/697346aa/poista',         // cancel alert
      'https://duunitori.fi?utm_source=Tyopaikkavahti',           // logo
    ]);
    expect(out).toEqual([
      'https://duunitori.fi/tyopaikat/tyo/ai-engineer-scsom-20567347',
      'https://duunitori.fi/tyopaikat/tyo/specialist-paid-social-scsom-20567401',
    ]);
  });

  it('keeps a The Hub posting but not its browse link', () => {
    const out = pipeline('noreply@thehub.io', [
      'https://thehub.io/jobs/6aa0e558dc6b58d5a066459d',
      'https://thehub.io/jobs/?roles=projectmanagement&roles=operations',
      'https://thehub.io/profile-settings/67eQDlNq9pvDyX0ThIiBGAqO',
    ]);
    expect(out).toEqual(['https://thehub.io/jobs/6aa0e558dc6b58d5a066459d']);
  });

  it('yields nothing from LinkedIn engagement mail', () => {
    // messages-noreply sends profile views and course promos -- 100% noise in
    // a week-long sample of the label.
    const out = pipeline('messages-noreply@linkedin.com', [
      'https://www.linkedin.com/comm/feed/update/urn:li:activity:123',
      'https://www.linkedin.com/learning/some-course',
      'https://www.linkedin.com/comm/in/someone',
    ]);
    expect(out).toEqual([]);
  });
});

describe('non-job senders are unaffected', () => {
  it('passes every link through for a sender with no profile', () => {
    const urls = ['https://example.com/one', 'https://example.com/two', 'https://docs.example.com/'];
    expect(pipeline('colleague@somecompany.com', urls)).toEqual(urls);
  });
});

describe('already-imported items still deduplicate', () => {
  it('recovers the canonical posting from a tracker URL stored by an earlier import', () => {
    // Work items imported before canonicalisation hold the raw Mandrill link.
    // The safety net in gmailImport runs stored URLs back through this path, so
    // they must land on the identity the pipeline produces now -- otherwise the
    // first run after this change re-imports everything as duplicates.
    const stored = JOBLY_MANDRILL;
    const recovered = canonicalizeByHost(normalizeUrl(stored)!);
    const fresh = pipeline('noreply@jobly.fi', [JOBLY_MANDRILL])[0];
    expect(recovered).toBe(fresh);
    expect(recovered).toBe('https://www.jobly.fi/tyopaikka/ops-specialist-tuusula-helsinki-2734734');
  });

  it('returns null for a URL that is not a posting', () => {
    expect(canonicalizeByHost('https://example.com/whatever')).toBeNull();
  });
});

describe('default job query', () => {
  it('searches every sender the module can actually read', () => {
    const q = defaultJobQuery();
    for (const sender of JOB_SOURCES.flatMap((s) => s.alertSenders)) {
      expect(q).toContain(sender);
    }
  });

  it('leaves out the LinkedIn sender that only carries engagement mail', () => {
    // messages-noreply matches the linkedin profile but never carries a
    // posting, so searching it would only cost quota.
    expect(defaultJobQuery()).not.toContain('messages-noreply');
  });

  it('is a valid single Gmail from: clause', () => {
    expect(defaultJobQuery()).toMatch(/^from:\(\S[^)]*\) newer_than:30d$/);
  });
});

describe('Työmarkkinatori', () => {
  const JOB =
    'https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/3917070e-67dd-4452-b9ec-5bc7e7b5ef1e/fi';

  it('keeps postings and strips the locale segment', () => {
    // The uuid is the identity; /fi, /sv and /en are the same posting.
    const out = pipeline('noreply@tyomarkkinatori.fi', [JOB, JOB.replace(/\/fi$/, '/en')]);
    expect(out).toEqual([
      'https://tyomarkkinatori.fi/henkiloasiakkaat/avoimet-tyopaikat/3917070e-67dd-4452-b9ec-5bc7e7b5ef1e',
    ]);
  });

  it('drops the unsubscribe links, which carry the recipient address', () => {
    const out = pipeline('noreply@tyomarkkinatori.fi', [
      JOB,
      'https://tyomarkkinatori.fi/tyopaikkavahti/peruuta?type=jobwatch&token=abc&email=Jvahanii%40gmail.com',
      'https://tyomarkkinatori.fi/tyopaikkavahti/peruuta-kaikki?type=jobwatch&token=abc&email=Jvahanii%40gmail.com',
    ]);
    expect(out).toHaveLength(1);
    expect(out[0]).not.toContain('email');
  });
});

describe('jobs2web / SuccessFactors career sites', () => {
  it('keeps the posting and discards the alert-management chrome', () => {
    // One profile serves every employer on jobs2web; the host varies, the path
    // shape does not.
    const out = pipeline('nordeabank-jobnotification@noreply12.jobs2web.com', [
      'http://careers.nordea.com/job/Helsinki-AI-Platform-Engineer-00500/1382818133/?from=email&utm_source=J2WEmail&source=2&locale=en_US',
      'https://career5.successfactors.eu/careers?site=&company=nordeabank&clientId=jobs2web',
      'https://careers.nordea.com/unsubscribe/?from=email&source=2',
      'https://www.nordea.com/en/careers/open-jobs',
    ]);
    expect(out).toEqual(['http://careers.nordea.com/job/Helsinki-AI-Platform-Engineer-00500/1382818133']);
  });

  it('covers a different employer on the same platform', () => {
    const out = pipeline('wrtsiloyj-jobnotification@noreply12.jobs2web.com', [
      'https://careers.wartsila.com/job/Helsinki-Some-Role-00100/1234567/?from=email',
    ]);
    expect(out).toEqual(['https://careers.wartsila.com/job/Helsinki-Some-Role-00100/1234567']);
  });
});

describe('Teamtailor', () => {
  it('keeps the posting from a per-company Teamtailor site', () => {
    const out = pipeline('no-reply@sofigategroupoy.teamtailor-mail.com', [
      'https://sofigategroupoy.teamtailor.com/jobs/8356594-interim-it-leader-senior-it-program-manager',
      'https://sofigategroupoy.teamtailor.com/',
    ]);
    expect(out).toEqual([
      'https://sofigategroupoy.teamtailor.com/jobs/8356594-interim-it-leader-senior-it-program-manager',
    ]);
  });
});
