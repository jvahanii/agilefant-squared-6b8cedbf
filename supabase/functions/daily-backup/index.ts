// Daily backup job – invoked by pg_cron. Iterates all organizations and snapshots each.
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: corsHeaders });

  const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
  const serviceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
  const admin = createClient(supabaseUrl, serviceKey);

  const { data: orgs, error } = await admin.from("organizations").select("id");
  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }

  let ok = 0;
  const failures: { org: string; error: string }[] = [];
  for (const o of orgs ?? []) {
    const { error: rpcError } = await admin.rpc("create_organization_backup", {
      _org_id: o.id,
      _kind: "auto",
      _note: null,
    });
    if (rpcError) failures.push({ org: o.id, error: rpcError.message });
    else ok++;
  }

  return new Response(JSON.stringify({ ok, total: orgs?.length ?? 0, failures }), {
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
});
