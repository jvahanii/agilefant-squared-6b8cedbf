-- Make a deleted work item restorable, so undoing a delete brings all of it back.
--
-- Since 20260914220000 every table holding a work_item_id that describes the
-- item cascades on delete: backlog and board ranks, hyperlinks, team
-- assignments, financials, snoozes, scrambles. That fixed orphaned rows, and
-- made a delete final. Undo in the app only swaps its local snapshot back, and
-- the next edit re-saved the items through a plain upsert: the work_items row
-- and its ranks came back, and everything else stayed gone. On 2026-09-16 that
-- lost the job-posting links of 18 items at once.
--
-- The client cannot put those rows back itself. It cannot read a scrambled
-- item's original_title, nor another member's snooze, and it would have to
-- fetch every child table before each delete. The database already holds all
-- of it at the moment of the delete, so it is kept there:
--
--   - bulk_delete_work_items() copies each item and its child rows into
--     deleted_work_items before deleting, in the same transaction.
--   - restore_deleted_work_items() puts back the latest copy of each id.
--
-- Copies older than seven days are purged on the next delete. The undo stack
-- lives in the page and is gone on reload, so nothing needs them for longer.
--
-- time_entries and work_item_history do not cascade, so a delete never removed
-- them and a restore has nothing to put back.

BEGIN;

-- 1. The archive. No policies: only the two functions below touch it.
CREATE TABLE IF NOT EXISTS public.deleted_work_items (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  work_item_id text NOT NULL,
  organization_id uuid NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now(),
  deleted_by uuid,
  item jsonb NOT NULL,
  children jsonb NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_deleted_work_items_item
  ON public.deleted_work_items (work_item_id, deleted_at DESC);
CREATE INDEX IF NOT EXISTS idx_deleted_work_items_deleted_at
  ON public.deleted_work_items (deleted_at);

ALTER TABLE public.deleted_work_items ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.deleted_work_items FROM anon, authenticated;

COMMENT ON TABLE public.deleted_work_items IS
  'Work items deleted through bulk_delete_work_items, with their cascaded child rows, kept seven days so restore_deleted_work_items can undo the delete.';

-- 2. Delete, keeping a copy first. Same permission check and history
--    suppression as before; the copy is the only new step.
CREATE OR REPLACE FUNCTION public.bulk_delete_work_items(_ids text[])
 RETURNS integer
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
  _deleted integer;
BEGIN
  _caller := public.current_user_id();
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN 0;
  END IF;

  IF _caller IS NOT NULL AND NOT is_superuser(_caller) THEN
    IF EXISTS (
      SELECT 1 FROM work_items wi
      WHERE wi.id = ANY(_ids)
        AND NOT is_member_of(_caller, wi.organization_id)
    ) THEN
      RAISE EXCEPTION 'Permission denied: not a member of one or more item organizations';
    END IF;
  END IF;

  DELETE FROM deleted_work_items WHERE deleted_at < now() - interval '7 days';

  INSERT INTO deleted_work_items (work_item_id, organization_id, deleted_by, item, children)
  SELECT w.id, w.organization_id, _caller, to_jsonb(w), jsonb_build_object(
    'work_item_backlog_ranks',    COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM work_item_backlog_ranks x    WHERE x.work_item_id = w.id), '[]'::jsonb),
    'work_item_board_ranks',      COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM work_item_board_ranks x      WHERE x.work_item_id = w.id), '[]'::jsonb),
    'work_item_hyperlinks',       COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM work_item_hyperlinks x       WHERE x.work_item_id = w.id), '[]'::jsonb),
    'work_item_team_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM work_item_team_assignments x WHERE x.work_item_id = w.id), '[]'::jsonb),
    'work_item_financials',       COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM work_item_financials x       WHERE x.work_item_id = w.id), '[]'::jsonb),
    'work_item_snoozes',          COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM work_item_snoozes x          WHERE x.work_item_id = w.id), '[]'::jsonb),
    'work_item_scrambles',        COALESCE((SELECT jsonb_agg(to_jsonb(x)) FROM work_item_scrambles x        WHERE x.work_item_id = w.id), '[]'::jsonb)
  )
  FROM work_items w
  WHERE w.id = ANY(_ids);

  PERFORM set_config('burnups.skip_history', 'on', true);
  DELETE FROM work_items WHERE id = ANY(_ids);
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$function$;

-- 3. Restore. Returns the ids that are live afterwards with their copy applied,
--    so the caller can fall back to its own state for any id it does not name
--    (never deleted through the RPC, or purged).
--
--    Every insert is ON CONFLICT DO NOTHING: if the app already re-saved the
--    item or its ranks, what it wrote stands. History stays off, as it was for
--    the delete — a burnup never saw the item leave, so it must not see it
--    arrive twice.
CREATE OR REPLACE FUNCTION public.restore_deleted_work_items(_ids text[])
 RETURNS text[]
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
  _row deleted_work_items%ROWTYPE;
  _restored text[] := '{}';
BEGIN
  _caller := public.current_user_id();
  IF _ids IS NULL OR array_length(_ids, 1) IS NULL THEN
    RETURN _restored;
  END IF;

  -- Unlike the delete, a request carrying a JWT with no matching profile is
  -- refused rather than waved through: only a database session with no JWT at
  -- all (a migration, the SQL editor) skips the membership check.
  IF NOT (_caller IS NULL AND auth.jwt() IS NULL)
     AND NOT COALESCE(is_superuser(_caller), false) THEN
    IF EXISTS (
      SELECT 1 FROM deleted_work_items d
      WHERE d.work_item_id = ANY(_ids)
        AND NOT COALESCE(is_member_of(_caller, d.organization_id), false)
    ) THEN
      RAISE EXCEPTION 'Permission denied: not a member of one or more item organizations';
    END IF;
  END IF;

  PERFORM set_config('burnups.skip_history', 'on', true);

  FOR _row IN
    SELECT DISTINCT ON (d.work_item_id) d.*
    FROM deleted_work_items d
    WHERE d.work_item_id = ANY(_ids)
    ORDER BY d.work_item_id, d.deleted_at DESC, d.id DESC
  LOOP
    INSERT INTO work_items
    SELECT (jsonb_populate_record(NULL::work_items, _row.item)).*
    ON CONFLICT (id) DO NOTHING;

    INSERT INTO work_item_backlog_ranks
    SELECT (jsonb_populate_record(NULL::work_item_backlog_ranks, c)).*
    FROM jsonb_array_elements(COALESCE(_row.children->'work_item_backlog_ranks', '[]'::jsonb)) c
    ON CONFLICT DO NOTHING;

    INSERT INTO work_item_board_ranks
    SELECT (jsonb_populate_record(NULL::work_item_board_ranks, c)).*
    FROM jsonb_array_elements(COALESCE(_row.children->'work_item_board_ranks', '[]'::jsonb)) c
    ON CONFLICT DO NOTHING;

    INSERT INTO work_item_hyperlinks
    SELECT (jsonb_populate_record(NULL::work_item_hyperlinks, c)).*
    FROM jsonb_array_elements(COALESCE(_row.children->'work_item_hyperlinks', '[]'::jsonb)) c
    ON CONFLICT DO NOTHING;

    -- A team deleted since would fail the foreign key and the whole restore;
    -- the assignment has nothing to point at, so it is dropped.
    INSERT INTO work_item_team_assignments
    SELECT r.*
    FROM jsonb_array_elements(COALESCE(_row.children->'work_item_team_assignments', '[]'::jsonb)) c,
         LATERAL jsonb_populate_record(NULL::work_item_team_assignments, c) r
    WHERE EXISTS (SELECT 1 FROM teams t WHERE t.id = r.team_id)
    ON CONFLICT DO NOTHING;

    INSERT INTO work_item_financials
    SELECT (jsonb_populate_record(NULL::work_item_financials, c)).*
    FROM jsonb_array_elements(COALESCE(_row.children->'work_item_financials', '[]'::jsonb)) c
    ON CONFLICT DO NOTHING;

    INSERT INTO work_item_snoozes
    SELECT (jsonb_populate_record(NULL::work_item_snoozes, c)).*
    FROM jsonb_array_elements(COALESCE(_row.children->'work_item_snoozes', '[]'::jsonb)) c
    ON CONFLICT DO NOTHING;

    -- The stored title is the scramble, so the scramble row has to come back
    -- with it or the real title is lost for good. Its author may be gone.
    INSERT INTO work_item_scrambles
    SELECT r.work_item_id, r.organization_id,
           CASE WHEN EXISTS (SELECT 1 FROM profiles p WHERE p.id = r.scrambled_by) THEN r.scrambled_by END,
           r.original_title, r.created_at
    FROM jsonb_array_elements(COALESCE(_row.children->'work_item_scrambles', '[]'::jsonb)) c,
         LATERAL jsonb_populate_record(NULL::work_item_scrambles, c) r
    ON CONFLICT DO NOTHING;

    _restored := _restored || _row.work_item_id;
  END LOOP;

  DELETE FROM deleted_work_items WHERE work_item_id = ANY(_restored);
  RETURN _restored;
END;
$function$;

REVOKE ALL ON FUNCTION public.restore_deleted_work_items(text[]) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.restore_deleted_work_items(text[]) TO authenticated, service_role;

COMMIT;
