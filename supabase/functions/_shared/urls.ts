// URL normalisation for links extracted from email.
//
// Deliberately dependency-free so it runs under Deno (edge functions) and under
// vitest (src/test) without a Deno shim.

export function decodeEntities(text: string): string {
  return text
    .replace(/&nbsp;/gi, ' ')
    .replace(/&amp;/gi, '&')
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'")
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>');
}

/**
 * Query params that identify a *send* rather than a *destination*. Stripping
 * them is what lets the same posting, mailed twice, resolve to one URL.
 *
 * Matched as prefixes, so `trk` also covers `trkEmail`.
 *
 * `identity_token` is listed for a second reason: Duunitori's copy is a JWT
 * whose payload is the recipient's email address, and extracted URLs get
 * stored on work items that can be shared through published links.
 */
const STRIP_PARAMS =
  /^(utm_|mc_|ck_|hsa_|fbclid|gclid|mkt_tok|_hs|vero_|trk|ref_src|refId|trackingId|lipi|midToken|midSig|otpToken|eid|ek|identity_token|savedSearchId|originToLandingJobPostings)/i;

function b64decode(s: string): string {
  const norm = s.replace(/-/g, '+').replace(/_/g, '/');
  return atob(norm + '='.repeat((4 - (norm.length % 4)) % 4));
}

/**
 * Mandrill wraps every link as /track/click/<id>/<host>?p=<base64 JSON>, where
 * the JSON carries the real destination. Jobly, The Hub and many other senders
 * use it, so without this their links are stored as opaque trackers -- and
 * because the payload embeds a per-message timestamp, the same posting mailed
 * twice would never deduplicate.
 *
 * Decoded rather than followed: requesting the tracker would register a click.
 */
function unwrapMandrill(u: URL): string | null {
  if (!/(^|\.)mandrillapp\.com$/i.test(u.hostname)) return null;
  if (!u.pathname.startsWith('/track/click')) return null;
  const p = u.searchParams.get('p');
  if (!p) return null;
  try {
    const outer = JSON.parse(b64decode(p)) as { p?: unknown };
    const inner = (typeof outer.p === 'string' ? JSON.parse(outer.p) : outer.p) as { url?: unknown };
    return typeof inner?.url === 'string' && inner.url ? decodeEntities(inner.url) : null;
  } catch {
    return null;
  }
}

/** Unwrap redirect wrappers and strip tracking query params. */
export function normalizeUrl(raw: string): string | null {
  let candidate = raw.trim();
  if (!candidate) return null;
  for (let i = 0; i < 3; i++) {
    let u: URL;
    try {
      u = new URL(candidate);
    } catch {
      return null;
    }
    if (u.protocol !== 'http:' && u.protocol !== 'https:') return null;

    const mandrill = unwrapMandrill(u);
    if (mandrill) {
      candidate = mandrill;
      continue;
    }

    const wrapped = u.searchParams.get('q') ?? u.searchParams.get('url') ?? u.searchParams.get('u');
    const isRedirector =
      /(^|\.)google\.[a-z.]+$/i.test(u.hostname) && (u.pathname === '/url' || u.pathname.startsWith('/url'));
    if (wrapped && (isRedirector || /(^|\.)(safelinks\.protection\.outlook\.com|t\.co|links?\..+)$/i.test(u.hostname))) {
      candidate = wrapped;
      continue;
    }

    const keys = [...u.searchParams.keys()];
    for (const k of keys) if (STRIP_PARAMS.test(k)) u.searchParams.delete(k);
    u.hash = '';
    let out = u.toString();
    if (out.endsWith('?')) out = out.slice(0, -1);
    return out;
  }
  return null;
}
