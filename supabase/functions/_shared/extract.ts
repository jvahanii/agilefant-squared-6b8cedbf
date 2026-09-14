// Pure extraction of links from a Gmail message.
//
// Split out of gmail.ts so it can be unit-tested: that module imports the
// Supabase client from a URL, which the test runner cannot resolve. Nothing
// here touches the network or Deno APIs.

import { decodeEntities, normalizeUrl } from './urls.ts';
import { filterJobLinks } from './jobSources.ts';

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
  'beacon',
  'pixel',
  'tracking',
];

const BLOCKED_TEXT_HINTS = ['unsubscribe', 'peruuta', 'view in browser', 'manage preferences', 'update preferences'];

export interface ExtractedLink {
  url: string;
  title: string;
  messageId: string;
  subject: string;
  from: string;
  date: string;
}

function looksLikeNoise(url: string, label: string): boolean {
  const lowerUrl = url.toLowerCase();
  if (BLOCKED_HOST_HINTS.some((h) => lowerUrl.includes(h))) return true;
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

/** Extract de-duplicated links from a Gmail message. */
export function extractLinks(msg: GmailMessage, mode: LinkMode = 'links'): ExtractedLink[] {
  const bodies = { html: [] as string[], text: [] as string[] };
  collectBodies(msg.payload, bodies);

  const subject = header(msg, 'Subject') || '(no subject)';
  const from = header(msg, 'From');
  const date = msg.internalDate
    ? new Date(Number(msg.internalDate)).toISOString()
    : header(msg, 'Date');

  const byUrl = new Map<string, ExtractedLink>();

  const push = (rawUrl: string, rawLabel: string) => {
    const url = normalizeUrl(decodeEntities(rawUrl));
    if (!url) return;
    const label = decodeEntities(rawLabel).replace(/\s+/g, ' ').trim();
    if (looksLikeNoise(url, label)) return;
    const title = (label && label.length > 2 && !/^https?:\/\//i.test(label) ? label : fallbackTitle(url)).slice(0, 300);
    if (!byUrl.has(url)) byUrl.set(url, { url, title, messageId: msg.id, subject, from, date });
  };

  for (const html of bodies.html) {
    const anchor = /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)'|([^\s>]+))[^>]*>([\s\S]*?)<\/a>/gi;
    let m: RegExpExecArray | null;
    while ((m = anchor.exec(html)) !== null) {
      const href = m[2] ?? m[3] ?? m[4] ?? '';
      const label = (m[5] ?? '').replace(/<[^>]*>/g, ' ');
      push(href, label);
    }
  }

  if (byUrl.size === 0) {
    for (const text of bodies.text) {
      const bare = /https?:\/\/[^\s<>()"']+/gi;
      let m: RegExpExecArray | null;
      while ((m = bare.exec(text)) !== null) push(m[0].replace(/[.,;:]+$/, ''), '');
    }
  }

  const all = [...byUrl.values()];
  return mode === 'jobs' ? filterJobLinks(from, all) : all;
}
