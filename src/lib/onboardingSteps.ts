import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Counts the steps into Agilefant in the database (onboarding_steps, see
 * supabase/migrations/20261126120000_onboarding_steps.sql), 2026-11-26.
 *
 * A signed-out step is counted once per browser: the browser keeps a flag
 * that it was counted, never an identifier, and nothing sent says who it was.
 * "opened" is a signed-in person opening the app, counted once a day; the
 * database keeps it only for a person's first 30 days.
 *
 * Counting never gets in the way: an error is let go, and the flag is set
 * only once a count has gone through.
 */
export type SignedOutStep = "public_list_opened" | "try_opened" | "signin_opened" | "signup_opened";
export type OnboardingStep = SignedOutStep | "opened";

const FLAG = "agilefant.counted.";

function helsinkiDay(now: Date): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: "Europe/Helsinki" }).format(now);
}

/** Where the browser notes that this step was counted. */
export function countedFlag(step: OnboardingStep): string {
  return FLAG + step;
}

/** What it notes: that it was, or for "opened" on which day. */
function flagValue(step: OnboardingStep, now: Date): string {
  return step === "opened" ? helsinkiDay(now) : "1";
}

function alreadyCounted(step: OnboardingStep, now: Date): boolean {
  try {
    return localStorage.getItem(countedFlag(step)) === flagValue(step, now);
  } catch {
    return true; // no storage: better not counted than counted at every visit
  }
}

const inFlight = new Set<OnboardingStep>();

export async function countOnboardingStep(step: OnboardingStep, now = new Date()): Promise<void> {
  if (inFlight.has(step) || alreadyCounted(step, now)) return;
  inFlight.add(step);
  try {
    const { error } = await supabase.rpc("count_onboarding_step" as never, { _step: step } as never);
    if (!error) localStorage.setItem(countedFlag(step), flagValue(step, now));
  } catch {
    // Not counted this time; the next visit tries again.
  } finally {
    inFlight.delete(step);
  }
}

/** Counts a step when the page shows, if `when` holds. */
export function useOnboardingStep(step: OnboardingStep, when = true): void {
  useEffect(() => {
    if (when) void countOnboardingStep(step);
  }, [step, when]);
}
