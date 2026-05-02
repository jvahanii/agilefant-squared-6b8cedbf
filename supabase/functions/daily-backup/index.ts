// Daily backup job – invoked by pg_cron. Iterates all organizations and snapshots each.
// Authentication: requires either
//   1) Authorization: Bearer <SUPABASE_SERVICE_ROLE_KEY>  (used by pg_cron via pg_net.http_post), or
//   2) Authorization: Bearer <user JWT> where the user is a superuser.
// Without one of those, the function returns 401 and never iterates orgs.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const anonKey = Deno.env.get("SUPABASE_ANON_KEY")!;

  const authHeader = req.headers.get("Authorization") ?? "";
  const token = authHeader.toLowerCase().startsWith("bearer ")
    ? authHeader.slice(7).trim()
    : "";

  if (!token) {
    return new Response(JSON.stringify({ error: "Unauthorized" }), {
      status: 401,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  // Allow service-role calls (pg_cron / internal) without further checks.
  let authorized = token === serviceKey;

  // Otherwise, only allow superusers.
  if (!authorized) {
    const userClient = createClient(supabaseUrl, anonKey, {
      global: { headers: { Authorization: `Bearer ${token}` } },
      auth: { persistSession: false },
    });
    const { data: userData, error: userErr } = await userClient.auth.getUser(token);
    if (userErr || !userData?.user) {
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }
    const { data: profile } = await userClient
      .from("profiles")
      .select("is_superuser")
      .eq("id", userData.user.id)
      .maybeSingle();
    authorized = profile?.is_superuser === true;
  }

  if (!authorized) {
    return new Response(JSON.stringify({ error: "Forbidden" }), {
      status: 403,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  const admin = createClient(supabaseUrl, serviceKey);

  const { data: orgs, error } = await admin.from("organizations").select("id");
  if (error) {
    return new Response(JSON.stringify({ error: "Failed to enumerate organizations" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let ok = 0;
  let failed = 0;
  for (const o of orgs ?? []) {
    const { error: rpcError } = await admin.rpc("create_organization_backup", {
      _org_id: o.id,
      _kind: "auto",
      _note: null,
    });
    if (rpcError) {
      failed++;
      console.error("backup failed for org", o.id, rpcError.message);
    } else {
      ok++;
    }
  }

  // Do NOT leak organization IDs in the response body.
  return new Response(JSON.stringify({ ok, failed, total: orgs?.length ?? 0 }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
