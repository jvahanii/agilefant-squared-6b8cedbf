-- Drop work item assignments that point at a tree or backlog which no longer
-- exists, and stop them being left behind again.
--
-- backlog_assignments is jsonb — tree id -> backlog id — so no foreign key can
-- clean it up when a tree or backlog is deleted. Four items in one organization
-- were still naming a tree and backlog that had been deleted; the app noticed
-- ("sanitizeData: dropped backlog assignment for item …") and dropped them on
-- load, every load, for every viewer. Each of those four also had a valid
-- assignment, so nothing here makes an item unreachable — an item whose *only*
-- assignment is stale is left alone rather than being quietly orphaned, and the
-- report at the end names any such case.

-- 1. The cleanup.
UPDATE public.work_items w
   SET backlog_assignments = (
     SELECT coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb)
       FROM jsonb_each_text(w.backlog_assignments) a
      WHERE EXISTS (SELECT 1 FROM public.backlog_trees t WHERE t.id = a.key)
        AND EXISTS (SELECT 1 FROM public.backlogs b WHERE b.id = a.value)
   )
 WHERE jsonb_typeof(w.backlog_assignments) = 'object'
   AND EXISTS (
     SELECT 1 FROM jsonb_each_text(w.backlog_assignments) a
      WHERE NOT EXISTS (SELECT 1 FROM public.backlog_trees t WHERE t.id = a.key)
         OR NOT EXISTS (SELECT 1 FROM public.backlogs b WHERE b.id = a.value)
   )
   -- Keep at least one usable assignment, or leave the row for a human.
   AND EXISTS (
     SELECT 1 FROM jsonb_each_text(w.backlog_assignments) a
      WHERE EXISTS (SELECT 1 FROM public.backlog_trees t WHERE t.id = a.key)
        AND EXISTS (SELECT 1 FROM public.backlogs b WHERE b.id = a.value)
   );

-- 2. Stop it happening again: deleting a tree or a backlog strips itself out of
-- every item that named it. Statement-level, so deleting a tree with hundreds
-- of backlogs costs one pass rather than one per row.
CREATE OR REPLACE FUNCTION public.clear_assignments_to_deleted_trees()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  UPDATE public.work_items w
     SET backlog_assignments = w.backlog_assignments - (SELECT array_agg(id) FROM deleted_trees)
   WHERE w.backlog_assignments ?| (SELECT array_agg(id) FROM deleted_trees);
  RETURN NULL;
END;
$function$;

CREATE OR REPLACE FUNCTION public.clear_assignments_to_deleted_backlogs()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Keyed by value here: the backlog id is the value, the tree id the key.
  UPDATE public.work_items w
     SET backlog_assignments = (
       SELECT coalesce(jsonb_object_agg(a.key, a.value), '{}'::jsonb)
         FROM jsonb_each_text(w.backlog_assignments) a
        WHERE a.value NOT IN (SELECT id FROM deleted_backlogs)
     )
   WHERE EXISTS (
     SELECT 1 FROM jsonb_each_text(w.backlog_assignments) a
      WHERE a.value IN (SELECT id FROM deleted_backlogs)
   );
  RETURN NULL;
END;
$function$;

DROP TRIGGER IF EXISTS trg_backlog_trees_clear_assignments ON public.backlog_trees;
CREATE TRIGGER trg_backlog_trees_clear_assignments
  AFTER DELETE ON public.backlog_trees
  REFERENCING OLD TABLE AS deleted_trees
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.clear_assignments_to_deleted_trees();

DROP TRIGGER IF EXISTS trg_backlogs_clear_assignments ON public.backlogs;
CREATE TRIGGER trg_backlogs_clear_assignments
  AFTER DELETE ON public.backlogs
  REFERENCING OLD TABLE AS deleted_backlogs
  FOR EACH STATEMENT
  EXECUTE FUNCTION public.clear_assignments_to_deleted_backlogs();

-- 3. Anything left: an item whose every assignment is stale, which the cleanup
-- deliberately did not touch. Raised as a notice, so the deploy log says so
-- without failing the migration.
DO $$
DECLARE _stranded int;
BEGIN
  SELECT count(*) INTO _stranded
    FROM public.work_items w
   WHERE jsonb_typeof(w.backlog_assignments) = 'object'
     AND w.backlog_assignments <> '{}'::jsonb
     AND NOT EXISTS (
       SELECT 1 FROM jsonb_each_text(w.backlog_assignments) a
        WHERE EXISTS (SELECT 1 FROM public.backlog_trees t WHERE t.id = a.key)
          AND EXISTS (SELECT 1 FROM public.backlogs b WHERE b.id = a.value)
     );
  IF _stranded > 0 THEN
    RAISE NOTICE 'work items whose only assignments name deleted containers: %', _stranded;
  END IF;
END;
$$;
