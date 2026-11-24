// The email someone gets the day after first signing in, and the signed
// links that unsubscribe them from it. Pure, so the tests can run it.

export interface ReminderInput {
  fullName: string | null;
  /** Items the person has added themselves, from the change log. */
  itemsAdded: number;
  appUrl: string;
  /** The page that asks to confirm unsubscribing. */
  unsubscribeUrl: string;
}

export interface Reminder {
  subject: string;
  text: string;
  html: string;
}

/** The name to greet with: the first word of the full name, unless that is an email address. */
export function greetingName(fullName: string | null): string | null {
  const first = (fullName ?? "").trim().split(/\s+/)[0] ?? "";
  if (!first || first.includes("@")) return null;
  return first;
}

/**
 * Asked of everyone, answered by replying (2026-11-24). It used to open when
 * the getting-started panel was closed, which reached those who had learnt
 * the basics; this reaches those who never came back as well.
 */
export const QUESTION =
  "One question: what were you hoping Agilefant would do? Just reply to this email; it goes to the people who make Agilefant.";

const escapeHtml = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export function buildReminder({ fullName, itemsAdded, appUrl, unsubscribeUrl }: ReminderInput): Reminder {
  const name = greetingName(fullName);
  const hello = name ? `Hi ${name},` : "Hi,";
  const hasItems = itemsAdded > 0;

  const subject = hasItems
    ? itemsAdded === 1
      ? "Your first item is waiting in Agilefant"
      : `Your ${itemsAdded} items are waiting in Agilefant`
    : "Add your first item to Agilefant";

  const paragraphs = hasItems
    ? [
        `Yesterday you signed up for Agilefant and added ${itemsAdded === 1 ? "your first item" : `${itemsAdded} items`}. A few things that help as your lists grow:`,
      ]
    : [
        "Yesterday you signed up for Agilefant. Your account is ready for the first thing you want to keep track of: a task, an idea, a job ad.",
        "It takes a few seconds: open Agilefant, type it and press Enter.",
      ];
  const tips = hasItems
    ? [
        "Drag items to put them in order, or onto another list.",
        "Select an item and press Tab to put it under the one above it; Shift+Tab moves it back out.",
        "Story points, deadlines, ratings and boards can be switched on in your organisation's settings: click the arrow next to your organisation's name.",
      ]
    : [];
  const button = hasItems ? "Open Agilefant" : "Add your first item";
  const footer = "You're getting this email once, the day after you signed up.";

  const text = [
    hello,
    "",
    ...paragraphs.flatMap((p) => [p, ""]),
    ...(tips.length ? [...tips.map((t) => `- ${t}`), ""] : []),
    `${button}: ${appUrl}`,
    "",
    QUESTION,
    "",
    "Agilefant",
    "",
    "--",
    footer,
    `Unsubscribe: ${unsubscribeUrl}`,
  ].join("\n");

  const p = (s: string) => `<p style="margin:0 0 16px">${escapeHtml(s)}</p>`;
  const html = `<!doctype html>
<html><body style="margin:0;padding:24px 16px;background:#f6f7f9;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#101418;font-size:15px;line-height:1.55">
<div style="max-width:520px;margin:0 auto;background:#ffffff;border:1px solid #e1e3e6;border-radius:10px;padding:28px 28px 20px">
${p(hello)}
${paragraphs.map(p).join("\n")}
${tips.length ? `<ul style="margin:0 0 16px;padding-left:20px">${tips.map((t) => `<li style="margin:0 0 6px">${escapeHtml(t)}</li>`).join("")}</ul>` : ""}
<p style="margin:8px 0 24px"><a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#256abf;color:#ffffff;text-decoration:none;font-weight:600;padding:10px 18px;border-radius:6px">${escapeHtml(button)}</a></p>
${p(QUESTION)}
<p style="margin:0 0 4px">Agilefant</p>
</div>
<p style="max-width:520px;margin:16px auto 0;font-size:12px;color:#545a63;text-align:center">${escapeHtml(footer)} <a href="${escapeHtml(unsubscribeUrl)}" style="color:#545a63">Unsubscribe</a></p>
</body></html>`;

  return { subject, text, html };
}

const hex = (buf: ArrayBuffer) => [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");

/** A signature that lets an unsubscribe link act for this person and no one else. */
export async function signUnsubscribe(userId: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret), { name: "HMAC", hash: "SHA-256" }, false, ["sign"]);
  return hex(await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(`unsubscribe:${userId}`)));
}

export async function verifyUnsubscribe(userId: string, signature: string, secret: string): Promise<boolean> {
  if (!/^[0-9a-f]{64}$/.test(signature)) return false;
  const expected = await signUnsubscribe(userId, secret);
  let diff = 0;
  for (let i = 0; i < expected.length; i++) diff |= expected.charCodeAt(i) ^ signature.charCodeAt(i);
  return diff === 0;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUserId = (s: unknown): s is string => typeof s === "string" && UUID.test(s);
