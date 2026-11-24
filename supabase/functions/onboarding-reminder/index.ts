// The email the day after someone first signs in (see the migration
// 20261116120000_next_day_reminder.sql), and unsubscribing from it.
//
//   POST with Authorization: Bearer <service role key>    pg_cron, hourly: send what is due
//   POST ?u=<user id>&s=<signature>                        one-click unsubscribe (mail apps)
//   POST {"unsubscribe": {"u": ..., "s": ...}}             the app's /unsubscribe page
//
// Sends nothing, and claims no one, until the RESEND_API_KEY secret is set.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import { buildReminder, isUserId, signUnsubscribe, verifyUnsubscribe } from "../_shared/onboardingEmail.ts";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};
const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { ...corsHeaders, "Content-Type": "application/json" } });

const BATCH = 50;

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });
  if (req.method !== "POST") return json({ error: "Method not allowed" }, 405);

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const linkSecret = Deno.env.get("EMAIL_LINK_SECRET") || serviceKey;
  const appUrl = (Deno.env.get("APP_URL") || "https://agilefant.org").replace(/\/$/, "");
  const admin = createClient(supabaseUrl, serviceKey);

  // Unsubscribing: from the link's own address (a mail app's one-click
  // button), or from the app's page.
  const url = new URL(req.url);
  let unsubscribe: { u?: unknown; s?: unknown } | null = url.searchParams.has("u")
    ? { u: url.searchParams.get("u"), s: url.searchParams.get("s") }
    : null;
  const token = (req.headers.get("Authorization") ?? "").replace(/^bearer\s+/i, "").trim();
  if (!unsubscribe && token !== serviceKey) {
    try {
      const body = await req.json();
      if (body && typeof body === "object" && body.unsubscribe) unsubscribe = body.unsubscribe;
    } catch {
      // Not JSON: neither kind of request this function answers.
    }
  }
  if (unsubscribe) {
    const { u, s } = unsubscribe;
    if (!isUserId(u) || typeof s !== "string" || !(await verifyUnsubscribe(u, s, linkSecret))) {
      return json({ error: "This unsubscribe link is not valid." }, 400);
    }
    const { error } = await admin.from("profiles").update({ product_emails_off: true }).eq("id", u);
    if (error) return json({ error: "Could not unsubscribe. Please try again." }, 500);
    return json({ unsubscribed: true });
  }

  if (token !== serviceKey) return json({ error: "Unauthorized" }, 401);

  const resendKey = Deno.env.get("RESEND_API_KEY");
  if (!resendKey) return json({ sent: 0, skipped: "RESEND_API_KEY is not set" });
  const from = Deno.env.get("ONBOARDING_FROM") || "Agilefant <hello@agilefant.org>";
  // Where answers to the email's question go (QUESTION in _shared/onboardingEmail.ts).
  const replyTo = Deno.env.get("ONBOARDING_REPLY_TO") || "jvahanii@gmail.com";
  const functionUrl = `${supabaseUrl}/functions/v1/onboarding-reminder`;

  const { data: due, error } = await admin.rpc("claim_onboarding_reminders", { _limit: BATCH });
  if (error) return json({ error: `claim_onboarding_reminders: ${error.message}` }, 500);

  let sent = 0;
  let failed = 0;
  for (const person of (due ?? []) as Array<{ user_id: string; email: string; full_name: string | null; items_added: number }>) {
    const query = `u=${person.user_id}&s=${await signUnsubscribe(person.user_id, linkSecret)}`;
    const email = buildReminder({
      fullName: person.full_name,
      itemsAdded: person.items_added,
      appUrl,
      unsubscribeUrl: `${appUrl}/unsubscribe?${query}`,
    });
    let failure: string | null = null;
    try {
      const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${resendKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          from,
          to: [person.email],
          reply_to: replyTo,
          subject: email.subject,
          html: email.html,
          text: email.text,
          headers: {
            "List-Unsubscribe": `<${functionUrl}?${query}>`,
            "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
          },
        }),
      });
      if (!res.ok) failure = `Resend ${res.status}: ${(await res.text()).slice(0, 300)}`;
    } catch (e) {
      failure = `Resend unreachable: ${e instanceof Error ? e.message : String(e)}`;
    }
    await admin
      .from("onboarding_emails")
      .update(failure ? { error: failure, had_items: person.items_added > 0 } : { sent_at: new Date().toISOString(), had_items: person.items_added > 0 })
      .eq("user_id", person.user_id);
    if (failure) {
      failed++;
      console.error("onboarding-reminder:", failure);
    } else {
      sent++;
    }
  }
  return json({ sent, failed });
});
