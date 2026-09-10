import { serve } from "https://deno.land/std@0.190.0/http/server.ts";
import Stripe from "https://esm.sh/stripe@18.5.0";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.57.2";
import { requireAppUser } from '../_shared/auth.ts';

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type, x-supabase-client-platform, x-supabase-client-platform-version, x-supabase-client-runtime, x-supabase-client-runtime-version",
};

const logStep = (step: string, details?: any) => {
  const d = details ? ` - ${JSON.stringify(details)}` : "";
  console.log(`[CREATE-CHECKOUT] ${step}${d}`);
};

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  const supabaseClient = createClient(
    Deno.env.get("SUPABASE_URL") ?? "",
    Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "",
    { auth: { persistSession: false } }
  );

  try {
    logStep("Function started");
    const stripeKey = Deno.env.get("STRIPE_SECRET_KEY");
    if (!stripeKey) throw new Error("STRIPE_SECRET_KEY is not set");

    // Resolves through current_user_id(), so a Clerk session maps to the same
    // profiles.id the RLS policies use. auth.getUser() could not: it resolves
    // against auth.users, where a Clerk subject never appears.
    const user = await requireAppUser(req);
    if (!user.email) throw new Error("User not authenticated or email not available");
    logStep("User authenticated", { userId: user.id });

    const { price_id, organization_id } = await req.json();
    if (!price_id) throw new Error("price_id is required");
    if (!organization_id) throw new Error("organization_id is required");

    // Server-side allowlist of valid Stripe price IDs. Must be kept in sync with
    // src/hooks/useSubscription.ts. Prevents callers from submitting arbitrary
    // (e.g. promotional or test) price IDs.
    const ALLOWED_PRICE_IDS = new Set<string>([
      "price_1TJIGCBRMLkyTCtAKXA3imQq", // starter
    ]);
    if (!ALLOWED_PRICE_IDS.has(price_id)) {
      throw new Error("Forbidden: invalid price_id");
    }

    // Verify the caller is a member of the organization
    const { data: membership } = await supabaseClient
      .from("memberships")
      .select("id")
      .eq("user_id", user.id)
      .eq("organization_id", organization_id)
      .maybeSingle();
    if (!membership) throw new Error("Forbidden: not a member of this organization");

    const stripe = new Stripe(stripeKey, { apiVersion: "2025-08-27.basil" });

    // Get or create Stripe customer for the org
    const { data: org } = await supabaseClient
      .from("organizations")
      .select("stripe_customer_id, name")
      .eq("id", organization_id)
      .single();

    let customerId = org?.stripe_customer_id;

    if (!customerId) {
      const customer = await stripe.customers.create({
        email: user.email,
        name: org?.name ?? undefined,
        metadata: { organization_id, created_by: user.id },
      });
      customerId = customer.id;
      logStep("Created Stripe customer", { customerId });

      // Save customer ID to org
      await supabaseClient
        .from("organizations")
        .update({ stripe_customer_id: customerId })
        .eq("id", organization_id);
    }

    // Security: validate origin against an allowlist to prevent open-redirect
    // abuse via attacker-supplied Origin headers (e.g. curl/Postman calls).
    const ALLOWED_ORIGINS = [
      "https://agilefant-squared.lovable.app",
      "https://id-preview--132685af-14e8-4da2-be0f-12e1778c35df.lovable.app",
      "http://localhost:3000",
      "http://localhost:5173",
    ];
    const rawOrigin = req.headers.get("origin") ?? "";
    const origin = ALLOWED_ORIGINS.includes(rawOrigin) ? rawOrigin : ALLOWED_ORIGINS[0];

    const session = await stripe.checkout.sessions.create({
      customer: customerId,
      line_items: [{ price: price_id, quantity: 1 }],
      mode: "subscription",
      success_url: `${origin}/?checkout=success`,
      cancel_url: `${origin}/?checkout=cancel`,
      metadata: { organization_id },
    });

    logStep("Checkout session created", { sessionId: session.id });

    return new Response(JSON.stringify({ url: session.url }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status: 200,
    });
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    logStep("ERROR", { message: msg });
    const status = msg.includes("Forbidden") ? 403
      : (msg.includes("authorization") || msg.includes("Authentication") || msg.includes("not authenticated")) ? 401
      : 500;
    const clientMsg = status === 403 ? "Forbidden" : status === 401 ? "Unauthorized" : "An internal error occurred";
    return new Response(JSON.stringify({ error: clientMsg }), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
      status,
    });
  }
});
