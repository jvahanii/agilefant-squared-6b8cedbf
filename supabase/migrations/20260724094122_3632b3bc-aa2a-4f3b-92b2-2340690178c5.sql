
-- 1. Make the burnup history trigger a no-op when no burnup-relevant field changed.
--    Also allow session-level skip via GUC 'burnups.skip_history' = 'on'.
CREATE OR REPLACE FUNCTION public.snapshot_work_item_change()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _event text;
  _src   record;
  _existed boolean;
  _skip text;
BEGIN
  -- Session-level bypass for bulk operations
  BEGIN
    _skip := current_setting('burnups.skip_history', true);
  EXCEPTION WHEN OTHERS THEN
    _skip := NULL;
  END;
  IF _skip = 'on' THEN
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  END IF;

  IF TG_OP = 'INSERT' THEN
    _event := 'insert'; _existed := true;  _src := NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    -- Skip when no burnup-relevant field changed
    IF NEW.status IS NOT DISTINCT FROM OLD.status
       AND NEW.points IS NOT DISTINCT FROM OLD.points
       AND NEW.parent_id IS NOT DISTINCT FROM OLD.parent_id
       AND NEW.title IS NOT DISTINCT FROM OLD.title
       AND COALESCE(NEW.backlog_assignments, '{}'::jsonb)
           IS NOT DISTINCT FROM COALESCE(OLD.backlog_assignments, '{}'::jsonb)
    THEN
      RETURN NEW;
    END IF;
    _event := 'update'; _existed := true;  _src := NEW;
  ELSE
    _event := 'delete'; _existed := false; _src := OLD;
  END IF;

  INSERT INTO public.work_item_history
    (work_item_id, organization_id, event, existed, title, status, points, parent_id, backlog_assignments)
  VALUES
    (_src.id, _src.organization_id, _event, _existed, _src.title, _src.status, _src.points, _src.parent_id,
     COALESCE(_src.backlog_assignments, '{}'::jsonb));

  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$function$;

-- 2. Remove work_item_history from realtime — the Burnup dialog fetches on open.
ALTER PUBLICATION supabase_realtime DROP TABLE public.work_item_history;
