-- What signed-out visitors (the anon role, anyone holding the public key) can
-- reach, checked against what they are meant to. One row per problem; no rows
-- means all is well. Run by .github/workflows/db-access-check.yml after every
-- migration and every morning.
--
-- Why: on 2026-11-12 two SECURITY DEFINER functions were found to let
-- signed-out callers change data (20261112090000). Each had come in with an
-- ordinary migration, under a default that let everyone call every function.

WITH allowed_for_anon(name) AS (
  -- What a public link page calls. See AUTH.md, "Public links".
  VALUES ('get_published_backlog'), ('get_published_link_features')
)
SELECT 'function' AS kind,
       p.oid::regprocedure::text AS name,
       'SECURITY DEFINER and callable signed out: REVOKE EXECUTE ... FROM PUBLIC, anon, or add it to allowed_for_anon in scripts/check-db-access.sql if a public page needs it' AS problem
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosecdef
   AND has_function_privilege('anon', p.oid, 'EXECUTE')
   AND p.proname NOT IN (SELECT name FROM allowed_for_anon)

UNION ALL
SELECT 'function', p.oid::regprocedure::text,
       'SECURITY DEFINER without a fixed search_path: add SET search_path TO ''public'''
  FROM pg_proc p
 WHERE p.pronamespace = 'public'::regnamespace
   AND p.prosecdef
   AND NOT EXISTS (SELECT 1 FROM unnest(coalesce(p.proconfig, '{}')) c WHERE c LIKE 'search\_path=%')

UNION ALL
SELECT 'table', c.oid::regclass::text,
       'row level security is off: ALTER TABLE ... ENABLE ROW LEVEL SECURITY'
  FROM pg_class c
 WHERE c.relnamespace = 'public'::regnamespace
   AND c.relkind IN ('r', 'p')
   AND NOT c.relrowsecurity

UNION ALL
SELECT 'policy', format('%s on %s', pol.policyname, pol.tablename),
       'applies to signed-out visitors (TO public or anon): write it TO authenticated'
  FROM pg_policies pol
 WHERE pol.schemaname = 'public'
   AND pol.roles && ARRAY['public', 'anon']::name[]

UNION ALL
SELECT 'default', format('functions made by %s%s', pg_get_userbyid(d.defaclrole),
                         CASE WHEN d.defaclnamespace = 0 THEN '' ELSE ' in ' || d.defaclnamespace::regnamespace::text END),
       'new functions would be callable signed out again: ALTER DEFAULT PRIVILEGES ... REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC, anon'
  FROM pg_default_acl d
 WHERE d.defaclobjtype = 'f'
   AND pg_get_userbyid(d.defaclrole) = 'postgres'
   AND d.defaclnamespace IN (0, 'public'::regnamespace)
   AND EXISTS (SELECT 1 FROM aclexplode(d.defaclacl) a
                WHERE a.privilege_type = 'EXECUTE'
                  AND (a.grantee = 0 OR a.grantee = 'anon'::regrole))

UNION ALL
-- With no default of its own, Postgres lets everyone call a new function.
SELECT 'default', 'functions made by postgres',
       'no default privileges recorded, so new functions are callable by everyone: ALTER DEFAULT PRIVILEGES FOR ROLE postgres REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC'
 WHERE NOT EXISTS (SELECT 1 FROM pg_default_acl d
                    WHERE d.defaclobjtype = 'f' AND d.defaclnamespace = 0
                      AND pg_get_userbyid(d.defaclrole) = 'postgres')

ORDER BY 1, 2;
