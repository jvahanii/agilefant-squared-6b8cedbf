import { supabase } from "@/integrations/supabase/client";

const BUCKET = "work-item-attachments";
const SIGN_TTL_SECONDS = 3600;

/**
 * Detect URLs that point at our (now private) work-item-attachments bucket.
 * Matches both old public-style URLs and signed/object URLs.
 */
export function isAttachmentUrl(url: string): boolean {
  return /\/storage\/v1\/object\/(public|sign|authenticated)\/work-item-attachments\//.test(url);
}

/**
 * Extract the storage path (everything after the bucket name) from an
 * attachment URL, stripping any query string.
 */
export function extractAttachmentPath(url: string): string | null {
  const m = url.match(/\/storage\/v1\/object\/(?:public|sign|authenticated)\/work-item-attachments\/([^?#]+)/);
  if (!m) return null;
  try {
    return decodeURIComponent(m[1]);
  } catch {
    return m[1];
  }
}

/**
 * Resolve a hyperlink URL to something openable. For attachment URLs (which
 * now live in a private bucket), this returns a fresh time-limited signed URL.
 * For any other URL, the original is returned unchanged.
 */
export async function resolveOpenableHref(url: string): Promise<string> {
  if (!isAttachmentUrl(url)) return url;
  const path = extractAttachmentPath(url);
  if (!path) return url;
  const { data, error } = await supabase.storage.from(BUCKET).createSignedUrl(path, SIGN_TTL_SECONDS);
  if (error || !data?.signedUrl) return url;
  return data.signedUrl;
}
