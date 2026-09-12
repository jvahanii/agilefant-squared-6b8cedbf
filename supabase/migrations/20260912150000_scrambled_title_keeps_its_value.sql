-- A write that would change a scrambled title keeps the scrambled one, rather
-- than aborting the whole statement.
--
-- The trigger raised an exception, which is right for a rename but wrong for
-- everything else that carries a title along with it:
--
--   - restore_organization_backup() in merge mode does
--     `INSERT ... ON CONFLICT (id) DO UPDATE SET title = EXCLUDED.title` for
--     every item in the snapshot. One scrambled item made the entire restore
--     fail.
--   - The app upserts whole item rows when moving items between backlogs. A
--     client that had not yet heard about the scramble would send the old
--     title, lose its move, and see "Failed to save".
--   - Undo restores a snapshot taken before the scramble, and the same upsert
--     follows.
--
-- Keeping the stored title is the safe answer in all three: the scramble holds,
-- the rest of the statement goes through, and nothing has to know about this.
-- The app still hides Rename on a scrambled item, so a person is told rather
-- than silently ignored.

CREATE OR REPLACE FUNCTION public.block_scrambled_title_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.title IS DISTINCT FROM OLD.title
     AND coalesce(current_setting('app.scrambling', true), '') <> 'on'
     AND EXISTS (SELECT 1 FROM public.work_item_scrambles s WHERE s.work_item_id = NEW.id)
  THEN
    NEW.title := OLD.title;
  END IF;
  RETURN NEW;
END;
$function$;
