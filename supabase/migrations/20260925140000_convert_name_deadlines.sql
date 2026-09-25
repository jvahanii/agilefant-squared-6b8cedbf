-- Turn deadlines written into names into deadlines of their own.
--
-- The job-ad importer named items "0930 Fortum — Analyst", and people typed
-- theirs the same way. Where the organization now has deadlines switched on,
-- the date moves into work_items.deadline (20260925090000) and the name loses
-- its prefix: "Fortum — Analyst", due 2026-09-30.
--
-- The year. The name never had one. The import also wrote the full date into
-- the description ("Applications close: 2026-09-30"), and where that states
-- the same day it is taken as it is. Otherwise the year is the one that puts
-- the date nearest today — the rule titleDeadline() already applies when it
-- reads a name, so the list reads the same before and after.
--
-- Left alone: organizations without deadlines, whose names are still the only
-- place a date is shown; items that already have a deadline; and a prefix that
-- is no calendar date in any nearby year ("0231", "1340"). Whitespace after the
-- prefix goes too — one name had a tab and a line break there.

UPDATE public.work_items w
   SET deadline = c.due,
       title = regexp_replace(w.title, '^\d{4}\s+', '')
  FROM (
    SELECT x.id,
           COALESCE(
             CASE
               WHEN x.stated IS NOT NULL
                AND to_char(x.stated::date, 'MMDD') = substr(x.title, 1, 4)
               THEN x.stated::date
             END,
             (SELECT make_date(y, x.m, x.d)
                FROM generate_series(extract(year FROM current_date)::int - 1,
                                     extract(year FROM current_date)::int + 1) AS y
               WHERE x.m BETWEEN 1 AND 12
                 AND x.d BETWEEN 1 AND extract(day FROM make_date(y, x.m, 1) + interval '1 month - 1 day')
               ORDER BY abs(make_date(y, x.m, x.d) - current_date)
               LIMIT 1)
           ) AS due
      FROM (
        SELECT w2.id,
               w2.title,
               substring(w2.title FROM '^(\d{2})\d{2}')::int AS m,
               substring(w2.title FROM '^\d{2}(\d{2})')::int AS d,
               substring(w2.description FROM 'Applications close: (\d{4}-\d{2}-\d{2})') AS stated
          FROM public.work_items w2
          JOIN public.organization_settings s
            ON s.organization_id = w2.organization_id
           AND s.deadlines_enabled
         WHERE w2.title ~ '^\d{4}\s'
           AND w2.deadline IS NULL
      ) x
  ) c
 WHERE w.id = c.id
   AND c.due IS NOT NULL;
