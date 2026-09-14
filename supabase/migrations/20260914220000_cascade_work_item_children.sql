-- Work item children: clear the orphans, and stop them being made.
--
-- bulk_delete_work_items is a plain DELETE FROM work_items, and of the nine
-- tables holding a work_item_id only work_item_scrambles had a foreign key. So
-- every deleted item left its rows behind: 3,948 orphaned backlog ranks, 2,866
-- board ranks, 1,192 hyperlinks.
--
-- That is not merely untidy. A rank row is how "this item is in this backlog"
-- is answered, so an emptied backlog still reported its old contents, and the
-- Gmail import marked postings as already present in a backlog holding nothing.
--
-- Two tables are deliberately left alone, because losing their rows destroys
-- records rather than tidying derived state:
--
--   time_entries        131 orphaned rows -- logged hours
--   work_item_history  2241 orphaned rows -- the audit trail
--
-- Cascading those would mean a delete silently discards time tracking and
-- history. That is a product decision, not a clean-up.
--
-- gmail_imported_links is also left without a foreign key, and must stay that
-- way: the import claims a row there *before* creating the work item, so a
-- foreign key would reject the claim.

BEGIN;

-- 1. Remove rows whose work item no longer exists.
DELETE FROM public.work_item_backlog_ranks x
  WHERE NOT EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = x.work_item_id);
DELETE FROM public.work_item_board_ranks x
  WHERE NOT EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = x.work_item_id);
DELETE FROM public.work_item_hyperlinks x
  WHERE NOT EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = x.work_item_id);
DELETE FROM public.work_item_financials x
  WHERE NOT EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = x.work_item_id);
DELETE FROM public.work_item_snoozes x
  WHERE NOT EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = x.work_item_id);
DELETE FROM public.work_item_team_assignments x
  WHERE NOT EXISTS (SELECT 1 FROM public.work_items w WHERE w.id = x.work_item_id);

-- 2. Index the referencing column, so the cascade does not table-scan on delete.
CREATE INDEX IF NOT EXISTS idx_work_item_backlog_ranks_item ON public.work_item_backlog_ranks(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_board_ranks_item ON public.work_item_board_ranks(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_hyperlinks_item ON public.work_item_hyperlinks(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_financials_item ON public.work_item_financials(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_snoozes_item ON public.work_item_snoozes(work_item_id);
CREATE INDEX IF NOT EXISTS idx_work_item_team_assignments_item ON public.work_item_team_assignments(work_item_id);

-- 3. Make it impossible to orphan them again.
--    ADD CONSTRAINT has no IF NOT EXISTS, hence the guard.
DO $$
DECLARE
  t text;
  fk text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'work_item_backlog_ranks',
    'work_item_board_ranks',
    'work_item_hyperlinks',
    'work_item_financials',
    'work_item_snoozes',
    'work_item_team_assignments'
  ] LOOP
    fk := t || '_work_item_id_fkey';
    IF NOT EXISTS (
      SELECT 1 FROM pg_constraint WHERE conname = fk AND conrelid = ('public.' || t)::regclass
    ) THEN
      EXECUTE format(
        'ALTER TABLE public.%I ADD CONSTRAINT %I FOREIGN KEY (work_item_id) '
        'REFERENCES public.work_items(id) ON DELETE CASCADE',
        t, fk
      );
    END IF;
  END LOOP;
END $$;

COMMIT;
