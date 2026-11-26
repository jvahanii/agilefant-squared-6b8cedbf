-- Counting the steps into Agilefant (2026-11-26).
--
-- With about one sign-up a day, Cloudflare Web Analytics keeps one visit in
-- ten and leaves out the public list pages, the way most newcomers arrive;
-- the change log shows edits but not someone who comes back to read. These
-- rows count the steps themselves:
--
--   Signed out, one row per browser the first time (the browser keeps only a
--   "counted" flag, no identifier, see src/lib/onboardingSteps.ts):
--     public_list_opened  a public list page (/p/…)
--     try_opened          the try-out page
--     signin_opened       the sign-in page
--     signup_opened       the sign-up page
--   Signed in:
--     opened              the app opened that day (Helsinki time), one row a
--                         day for each of a person's first 30 days. The first
--                         day is the sign-up; any later one is a return.
--
-- Accounts made, first items and copies of public lists are in profiles,
-- change_log and published_list_copies already. scripts/onboarding-funnel.sql
-- puts them all together.

CREATE TABLE public.onboarding_steps (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  step text NOT NULL CHECK (step IN ('public_list_opened', 'try_opened', 'signin_opened', 'signup_opened', 'opened')),
  user_id uuid REFERENCES public.profiles(id) ON DELETE CASCADE,
  day date NOT NULL DEFAULT (now() AT TIME ZONE 'Europe/Helsinki')::date,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX onboarding_steps_once_a_day ON public.onboarding_steps (user_id, step, day) WHERE user_id IS NOT NULL;
CREATE INDEX onboarding_steps_by_day ON public.onboarding_steps (day, step);

-- Read and written only by the function below.
ALTER TABLE public.onboarding_steps ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.onboarding_steps FROM PUBLIC, anon, authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.onboarding_steps TO service_role;

CREATE OR REPLACE FUNCTION public.count_onboarding_step(_step text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
  _today date := (now() AT TIME ZONE 'Europe/Helsinki')::date;
  _joined timestamptz;
BEGIN
  IF _step = 'opened' THEN
    IF _uid IS NULL THEN
      RETURN;
    END IF;
    SELECT p.created_at INTO _joined FROM public.profiles p WHERE p.id = _uid AND NOT coalesce(p.is_superuser, false);
    IF _joined IS NULL OR _joined < now() - interval '30 days' THEN
      RETURN;
    END IF;
    INSERT INTO public.onboarding_steps (step, user_id, day) VALUES ('opened', _uid, _today)
    ON CONFLICT DO NOTHING;
  ELSIF _step IN ('public_list_opened', 'try_opened', 'signin_opened', 'signup_opened') THEN
    -- Anyone holding the public key can call this: a day's count of a step
    -- stops at 1000, so a flood cannot fill the table.
    IF (SELECT count(*) FROM public.onboarding_steps s WHERE s.day = _today AND s.step = _step) >= 1000 THEN
      RETURN;
    END IF;
    INSERT INTO public.onboarding_steps (step, day) VALUES (_step, _today);
  END IF;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.count_onboarding_step(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.count_onboarding_step(text) TO anon, authenticated, service_role;

NOTIFY pgrst, 'reload schema';
