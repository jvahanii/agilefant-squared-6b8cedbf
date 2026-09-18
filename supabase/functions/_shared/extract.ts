// Pure extraction of links from a Gmail message.
//
// Split out of gmail.ts so it can be unit-tested: that module imports the
// Supabase client from a URL, which the test runner cannot resolve. Nothing
// here touches the network or Deno APIs.

import { decodeEntities, normalizeUrl } from './urls.ts';
import { filterJobLinks, type LinkOccurrence } from './jobSources.ts';

/**
 * Which extractor a query runs under.
 *
 *   links  the generic behaviour: every link in the message
 *   jobs   the job-ad feature: postings only, reduced to one canonical URL each
 *
 * Explicit rather than inferred from the sender, so the generic import never
 * changes behaviour because of who happened to send the mail.
 */
export type LinkMode = 'links' | 'jobs';

interface GmailPart {
  mimeType?: string;
  filename?: string;
  body?: { data?: string; size?: number };
  parts?: GmailPart[];
  headers?: Array<{ name: string; value: string }>;
}

export interface GmailMessage {
  id: string;
  internalDate?: string;
  payload?: GmailPart & { headers?: Array<{ name: string; value: string }> };
  snippet?: string;
}

function decodeB64Url(data: string): string {
  const normalized = data.replace(/-/g, '+').replace(/_/g, '/');
  const padded = normalized + '='.repeat((4 - (normalized.length % 4)) % 4);
  try {
    const bytes = Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
    return new TextDecoder('utf-8').decode(bytes);
  } catch {
    return '';
  }
}

function collectBodies(part: GmailPart | undefined, out: { html: string[]; text: string[] }) {
  if (!part) return;
  const data = part.body?.data;
  if (data && !part.filename) {
    if (part.mimeType === 'text/html') out.html.push(decodeB64Url(data));
    else if (part.mimeType === 'text/plain') out.text.push(decodeB64Url(data));
  }
  for (const child of part.parts ?? []) collectBodies(child, out);
}

export function header(msg: GmailMessage, name: string): string {
  const h = msg.payload?.headers?.find((x) => x.name.toLowerCase() === name.toLowerCase());
  return h?.value ?? '';
}

const BLOCKED_HOST_HINTS = [
  'unsubscribe',
  'list-manage.com/unsubscribe',
  'mailchi.mp/unsub',
  'sendgrid.net/wf/open',
];

/**
 * Words that mark a tracker — but only as a host label or a whole path segment
 * (pixel.example.com, /tracking/open), never inside one. Matched anywhere in the
 * URL they threw away NestAI's "machine-learning-engineer-object-tracking-re-
 * identification" posting, and would any job whose slug says tracking, pixel or
 * beacon.
 */
const TRACKER_WORDS = ['beacon', 'pixel', 'tracking'];

function looksLikeTracker(url: string): boolean {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  const parts = [...u.hostname.split('.'), ...u.pathname.split('/')].map((p) => p.toLowerCase());
  return parts.some((part) => TRACKER_WORDS.includes(part));
}

const BLOCKED_TEXT_HINTS = ['unsubscribe', 'peruuta', 'view in browser', 'manage preferences', 'update preferences'];

export interface ExtractedLink {
  url: string;
  title: string;
  messageId: string;
  subject: string;
  from: string;
  date: string;
  /** Employer, when the digest markup exposed one. Job sources only. */
  company?: string;
  /** Application deadline as yyyy-mm-dd, when one is known. */
  deadline?: string;
  /**
   * The posting says applications stay open, which is different from no
   * deadline having been found.
   */
  deadlineOpen?: boolean;
  /**
   * The posting has stopped taking applications — LinkedIn leaves those up, so
   * a digest still links to them. Imported only if deliberately chosen.
   */
  applicationsClosed?: boolean;
}

function looksLikeNoise(url: string, label: string): boolean {
  const lowerUrl = url.toLowerCase();
  if (BLOCKED_HOST_HINTS.some((h) => lowerUrl.includes(h))) return true;
  if (looksLikeTracker(url)) return true;
  const lowerLabel = label.toLowerCase();
  if (BLOCKED_TEXT_HINTS.some((h) => lowerLabel.includes(h))) return true;
  if (/\.(png|jpe?g|gif|svg|webp|css|js|ico)(\?|$)/i.test(url)) return true;
  return false;
}

function fallbackTitle(url: string): string {
  try {
    const u = new URL(url);
    const path = u.pathname.replace(/\/+$/, '');
    const last = path.split('/').filter(Boolean).pop();
    const readable = last
      ? decodeURIComponent(last).replace(/[-_]+/g, ' ').replace(/\.(html?|php|aspx)$/i, '')
      : '';
    return readable ? `${u.hostname} — ${readable}`.slice(0, 200) : u.hostname;
  } catch {
    return url.slice(0, 200);
  }
}

/**
 * How much markup after an anchor is carried along as that posting's context.
 *
 * It was 400, which is not enough for LinkedIn: between a title anchor and the
 * employer sit a closing cell, a new row, and a <p> carrying a long class and
 * style attribute -- some 420 characters in all. The window closed mid-tag, the
 * employer was never found, and so every posting in a digest fell back to the
 * one named in the subject line. Consumers cut this at the next anchor anyway,
 * so a generous window costs only the slice.
 */
const AFTER_WINDOW = 2000;

/**
 * And the markup before it. Most digests put the title in the anchor itself,
 * but Barona's anchors all read "View job": the title and the employer are the
 * lines above the link. Consumers cut this at the previous anchor.
 */
const BEFORE_WINDOW = 1500;

/** Extract de-duplicated links from a Gmail message. */
export function extractLinks(msg: GmailMessage, mode: LinkMode = 'links'): ExtractedLink[] {
  const bodies = { html: [] as string[], text: [] as string[] };
  collectBodies(msg.payload, bodies);

  const subject = header(msg, 'Subject') || '(no subject)';
  const from = header(msg, 'From');
  const date = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : header(msg, 'Date');

  // Every occurrence of a URL is kept, not just the first. A job digest links
  // the same posting two or three times -- logo, card wrapper, title -- and
  // only one of those anchors carries usable text. Keeping the first would
  // title the item from an empty logo anchor.
  const occurrences = new Map<string, LinkOccurrence[]>();

  const push = (rawUrl: string, rawLabel: string, after = '', before = '') => {
    const url = normalizeUrl(decodeEntities(rawUrl));
    if (!url) return;
    const label = decodeEntities(rawLabel).replace(/<[^>]*>/g, ' ').replace(/\s+/g, ' ').trim();
    if (looksLikeNoise(url, label)) return;
    const existing = occurrences.get(url);
    if (existing) existing.push({ label, after, before });
    else occurrences.set(url, [{ label, after, before }]);
  };

  for (const html of bodies.html) {
    const anchor = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchor.exec(html)) !== null) {
      const href = m[2] ?? m[3] ?? m[4] ?? '';
      // The markup that follows a posting's title anchor is where these
      // digests put the employer, so carry a slice of it along.
      const after = html.slice(anchor.lastIndex, anchor.lastIndex + AFTER_WINDOW);
      const before = html.slice(Math.max(0, m.index - BEFORE_WINDOW), m.index);
      push(href, m[5] ?? '', after, before);
    }
  }

  if (occurrences.size === 0) {
    for (const text of bodies.text) {
      const bare = /https?:\/\/[^\s<>()"']+/gi;
      let m: RegExpExecArray | null;
      while ((m = bare.exec(text)) !== null) {
        const url = m[0].replace(/[.,;:]+$/, '');
        push(url, '', text.slice(bare.lastIndex, bare.lastIndex + AFTER_WINDOW));
      }
    }
  }

  const isUsable = (label: string) => label.length > 2 && !/^https?:\/\//i.test(label);
  const all: ExtractedLink[] = [];
  for (const [url, occ] of occurrences) {
    const best = occ.find((o) => isUsable(o.label));
    all.push({
      url,
      title: (best?.label ?? fallbackTitle(url)).slice(0, 300),
      messageId: msg.id,
      subject,
      from,
      date,
    });
  }

  return mode === 'jobs' ? filterJobLinks(from, all, occurrences) : all;
}
