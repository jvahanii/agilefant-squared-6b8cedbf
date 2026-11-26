import { supabase } from "@/integrations/supabase/client";

/**
 * The try-out at /try runs the real app on example data held only in the
 * browser (2026-11-16). While it runs, the database client answers every
 * call itself and sends nothing but the count that the try-out was opened:
 * reads come back empty, writes come back as done, so the app's saving and
 * retry queues settle as if saved, and nothing of the try-out reaches the
 * database.
 *
 * It is switched on for the rest of the page's life, never off: leaving the
 * try-out reloads the page (pages/Try.tsx), so no signed-in session ever
 * runs with this client.
 */
let on = false;

export const isDemoMode = () => on;

const NOT_HERE = { message: "Not available in the try-out" };

/** A query builder that takes any chain of calls and answers with nothing. */
function emptyQuery(): unknown {
  let single = false;
  const answer = () => ({ data: single ? null : [], error: null, count: 0, status: 200, statusText: "OK" });
  const builder: unknown = new Proxy(function () {}, {
    get(_target, prop) {
      if (prop === "then") {
        return (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) =>
          Promise.resolve(answer()).then(resolve, reject);
      }
      if (prop === "single" || prop === "maybeSingle") {
        return () => {
          single = true;
          return builder;
        };
      }
      return () => builder;
    },
  });
  return builder;
}

function fakeChannel(): unknown {
  const channel: Record<string, unknown> = {};
  for (const m of ["on", "subscribe", "unsubscribe", "send", "track", "untrack", "presenceState"]) {
    channel[m] = () => (m === "unsubscribe" || m === "send" ? Promise.resolve("ok") : channel);
  }
  return channel;
}

export function enterDemoMode(): void {
  if (on) return;
  on = true;
  const client = supabase as unknown as Record<string, unknown>;
  // The one call that still goes out: that the try-out was opened
  // (lib/onboardingSteps.ts), which carries nothing of it.
  const realRpc = (client.rpc as (name: string, args?: unknown) => unknown).bind(supabase);
  client.from = () => emptyQuery();
  client.schema = () => ({ from: () => emptyQuery(), rpc: async () => ({ data: null, error: null }) });
  client.rpc = (name: string, args?: unknown) =>
    name === "count_onboarding_step" ? realRpc(name, args) : emptyQuery();
  client.channel = () => fakeChannel();
  client.removeChannel = async () => "ok";
  client.removeAllChannels = async () => [];
  client.getChannels = () => [];
  Object.defineProperty(client, "functions", {
    configurable: true,
    get: () => ({ invoke: async () => ({ data: null, error: NOT_HERE }) }),
  });
  Object.defineProperty(client, "storage", {
    configurable: true,
    get: () => ({
      from: () =>
        new Proxy({}, { get: () => async () => ({ data: null, error: NOT_HERE }) }),
    }),
  });
}
