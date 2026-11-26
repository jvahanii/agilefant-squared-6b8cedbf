/**
 * The try-out switches the database off, all but the count that it was
 * opened: before 2026-11-26 that count was answered by the try-out itself,
 * so it was noted as counted and never reached the database.
 */
import { describe, it, expect, vi } from "vitest";

const { rpc } = vi.hoisted(() => ({ rpc: vi.fn(async () => ({ data: null, error: null })) }));
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc } }));

import { enterDemoMode } from "@/lib/demoMode";
import { supabase } from "@/integrations/supabase/client";

describe("the try-out's database client", () => {
  it("lets only the step count through", async () => {
    enterDemoMode();
    await supabase.rpc("count_onboarding_step" as never, { _step: "try_opened" } as never);
    await supabase.rpc("get_published_backlog" as never, { _token: "x" } as never);
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("count_onboarding_step", { _step: "try_opened" });
  });
});
