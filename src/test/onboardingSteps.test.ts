/**
 * The steps into Agilefant are counted in the database once per browser, or
 * for "opened" once a day, without anything that says who it was.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";

const rpc = vi.fn();
vi.mock("@/integrations/supabase/client", () => ({ supabase: { rpc: (...a: unknown[]) => rpc(...a) } }));

import { countOnboardingStep, countedFlag } from "@/lib/onboardingSteps";

beforeEach(() => {
  localStorage.clear();
  rpc.mockReset();
  rpc.mockResolvedValue({ data: null, error: null });
});

describe("counting a step into Agilefant", () => {
  it("sends only the step, and counts a signed-out step once per browser", async () => {
    await countOnboardingStep("try_opened");
    await countOnboardingStep("try_opened");
    expect(rpc).toHaveBeenCalledTimes(1);
    expect(rpc).toHaveBeenCalledWith("count_onboarding_step", { _step: "try_opened" });
    expect(localStorage.getItem(countedFlag("try_opened"))).toBe("1");
  });

  it("counts each step on its own", async () => {
    await countOnboardingStep("public_list_opened");
    await countOnboardingStep("signup_opened");
    expect(rpc.mock.calls.map((c) => c[1])).toEqual([{ _step: "public_list_opened" }, { _step: "signup_opened" }]);
  });

  it("counts opening the app once a day, by the Helsinki day", async () => {
    await countOnboardingStep("opened", new Date("2026-11-26T08:00:00Z"));
    await countOnboardingStep("opened", new Date("2026-11-26T21:00:00Z")); // 23:00 in Helsinki
    expect(rpc).toHaveBeenCalledTimes(1);
    await countOnboardingStep("opened", new Date("2026-11-26T22:30:00Z")); // past midnight there
    expect(rpc).toHaveBeenCalledTimes(2);
    expect(localStorage.getItem(countedFlag("opened"))).toBe("2026-11-27");
  });

  it("tries again next time when a count did not go through, and never throws", async () => {
    rpc.mockResolvedValueOnce({ data: null, error: { message: "down" } });
    await countOnboardingStep("signin_opened");
    rpc.mockRejectedValueOnce(new Error("offline"));
    await expect(countOnboardingStep("signin_opened")).resolves.toBeUndefined();
    expect(localStorage.getItem(countedFlag("signin_opened"))).toBeNull();
    await countOnboardingStep("signin_opened");
    expect(rpc).toHaveBeenCalledTimes(3);
    expect(localStorage.getItem(countedFlag("signin_opened"))).toBe("1");
  });

  it("sends one count while another of the same step is on its way", async () => {
    await Promise.all([countOnboardingStep("try_opened"), countOnboardingStep("try_opened")]);
    expect(rpc).toHaveBeenCalledTimes(1);
  });
});
