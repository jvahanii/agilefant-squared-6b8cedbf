-- 1. RLS hot path: membership lookups
CREATE INDEX IF NOT EXISTS idx_memberships_user_org ON public.memberships (user_id, organization_id);
CREATE INDEX IF NOT EXISTS idx_memberships_org ON public.memberships (organization_id);

-- 2. Org-scoped loader reads
CREATE INDEX IF NOT EXISTS idx_work_items_org ON public.work_items (organization_id);
CREATE INDEX IF NOT EXISTS idx_work_items_parent ON public.work_items (parent_id);
CREATE INDEX IF NOT EXISTS idx_wibr_org ON public.work_item_backlog_ranks (organization_id);
CREATE INDEX IF NOT EXISTS idx_wibr_backlog ON public.work_item_backlog_ranks (backlog_id);
CREATE INDEX IF NOT EXISTS idx_backlogs_org ON public.backlogs (organization_id);
CREATE INDEX IF NOT EXISTS idx_backlogs_tree ON public.backlogs (tree_id);
CREATE INDEX IF NOT EXISTS idx_wi_hyperlinks_org ON public.work_item_hyperlinks (organization_id);
CREATE INDEX IF NOT EXISTS idx_wi_hyperlinks_item ON public.work_item_hyperlinks (work_item_id);
CREATE INDEX IF NOT EXISTS idx_bts_org ON public.backlog_tree_shares (organization_id);
CREATE INDEX IF NOT EXISTS idx_bts_tree ON public.backlog_tree_shares (tree_id);
CREATE INDEX IF NOT EXISTS idx_backlog_trees_org ON public.backlog_trees (organization_id);
CREATE INDEX IF NOT EXISTS idx_backlog_statuses_backlog ON public.backlog_statuses (backlog_id);
CREATE INDEX IF NOT EXISTS idx_time_entries_org ON public.time_entries (organization_id);
CREATE INDEX IF NOT EXISTS idx_labels_org ON public.labels (organization_id);
CREATE INDEX IF NOT EXISTS idx_label_assignments_org ON public.label_assignments (organization_id);
CREATE INDEX IF NOT EXISTS idx_wita_org ON public.work_item_team_assignments (organization_id);
CREATE INDEX IF NOT EXISTS idx_wi_snoozes_org ON public.work_item_snoozes (organization_id);
CREATE INDEX IF NOT EXISTS idx_wi_financials_org ON public.work_item_financials (organization_id);

-- 3. Cheap change-log trimming: age-based, sampled, index-driven
CREATE OR REPLACE FUNCTION public.trim_change_log()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- Run only ~1 in 200 inserts; the previous version ran an expensive
  -- NOT IN (top 5000) subquery on every single insert.
  IF random() < 0.005 THEN
    DELETE FROM public.change_log
    WHERE organization_id = NEW.organization_id
      AND created_at < (now() - interval '90 days');
  END IF;
  RETURN NEW;
END;
$function$;

-- 4. Shorter backup retention
CREATE OR REPLACE FUNCTION public.trim_organization_backups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  DELETE FROM public.organization_backups
  WHERE organization_id = NEW.organization_id
    AND created_at < (now() - interval '14 days');
  RETURN NEW;
END;
$function$;
