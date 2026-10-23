-- Row-level security asks who the caller is once per query, not once per row.
--
-- Every policy in public named the caller as current_user_id(): a call
-- Postgres makes again for each row it checks — a lookup of the caller's
-- profile by their Clerk id each time. Written as (SELECT current_user_id()),
-- it is worked out once per query and reused, as Supabase advises for RLS
-- (https://supabase.com/docs/guides/database/postgres/row-level-security#call-functions-with-select).
-- Measured on the largest organization's 4 127 work items: the policy check
-- took 503 ms one way and 49 ms the other. What each policy allows is unchanged.
--
-- All 118 policies, rewritten from their own text rather than retyped: each
-- current_user_id() not already inside a SELECT is wrapped in one. One
-- transaction — a policy that will not take its new text undoes them all.

DO $rls$
DECLARE
  _p record;
  _qual text;
  _check text;
  _wrap constant text := '(?<!SELECT )((public\.)?current_user_id\(\))';
BEGIN
  FOR _p IN
    SELECT schemaname, tablename, policyname, qual, with_check
      FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') ~ '(?<!SELECT )current_user_id\(\)' OR coalesce(with_check, '') ~ '(?<!SELECT )current_user_id\(\)')
  LOOP
    _qual := regexp_replace(_p.qual, _wrap, '(SELECT \1)', 'g');
    _check := regexp_replace(_p.with_check, _wrap, '(SELECT \1)', 'g');
    IF _p.qual IS NOT NULL AND _qual IS DISTINCT FROM _p.qual THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I USING (%s)', _p.policyname, _p.schemaname, _p.tablename, _qual);
    END IF;
    IF _p.with_check IS NOT NULL AND _check IS DISTINCT FROM _p.with_check THEN
      EXECUTE format('ALTER POLICY %I ON %I.%I WITH CHECK (%s)', _p.policyname, _p.schemaname, _p.tablename, _check);
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1 FROM pg_policies
     WHERE schemaname = 'public'
       AND (coalesce(qual, '') ~ '(?<!SELECT )current_user_id\(\)' OR coalesce(with_check, '') ~ '(?<!SELECT )current_user_id\(\)')
  ) THEN
    RAISE EXCEPTION 'a policy still calls current_user_id() row by row';
  END IF;
END
$rls$;
