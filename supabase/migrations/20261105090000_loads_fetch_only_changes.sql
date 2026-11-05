-- Loads fetch only what changed since the copy the browser already has.
--
-- Every start and every catch-up downloaded all of an organization's items,
-- ranks and links again: some 7 MB, forty requests, about three times an hour,
-- on a database with 406 MB of memory, where each such burst left every other
-- request waiting seconds. Nearly all of it was rows the browser already had.
--
-- Now each of those rows records when it last changed, a deleted one leaves its
-- key behind for a month, and get_org_changes hands over, in one request, the
-- rows changed since a given time, the keys deleted since, and how many rows
-- there are, so the browser can tell its merged copy is whole.

-- ── When each row last changed ───────────────────────────────────────────────
-- A default of now() is stored once for the existing rows; the tables are not rewritten.
ALTER TABLE public.work_items ADD COLUMN IF NOT EXISTS changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.work_item_backlog_ranks ADD COLUMN IF NOT EXISTS changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.work_item_board_ranks ADD COLUMN IF NOT EXISTS changed_at timestamptz NOT NULL DEFAULT now();
ALTER TABLE public.work_item_hyperlinks ADD COLUMN IF NOT EXISTS changed_at timestamptz NOT NULL DEFAULT now();

CREATE INDEX IF NOT EXISTS idx_work_items_org_changed ON public.work_items (organization_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_wibr_org_changed ON public.work_item_backlog_ranks (organization_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_wibdr_org_changed ON public.work_item_board_ranks (organization_id, changed_at);
CREATE INDEX IF NOT EXISTS idx_wi_hyperlinks_org_changed ON public.work_item_hyperlinks (organization_id, changed_at);

-- Set on every write, whatever it carries: a row restored from a snapshot, or
-- copied from a backup, comes with an old time or none, and would be missed.
CREATE OR REPLACE FUNCTION public.touch_changed_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  NEW.changed_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_items_changed_at ON public.work_items;
CREATE TRIGGER trg_work_items_changed_at BEFORE INSERT OR UPDATE ON public.work_items
  FOR EACH ROW EXECUTE FUNCTION public.touch_changed_at();
DROP TRIGGER IF EXISTS trg_wibr_changed_at ON public.work_item_backlog_ranks;
CREATE TRIGGER trg_wibr_changed_at BEFORE INSERT OR UPDATE ON public.work_item_backlog_ranks
  FOR EACH ROW EXECUTE FUNCTION public.touch_changed_at();
DROP TRIGGER IF EXISTS trg_wibdr_changed_at ON public.work_item_board_ranks;
CREATE TRIGGER trg_wibdr_changed_at BEFORE INSERT OR UPDATE ON public.work_item_board_ranks
  FOR EACH ROW EXECUTE FUNCTION public.touch_changed_at();
DROP TRIGGER IF EXISTS trg_wi_hyperlinks_changed_at ON public.work_item_hyperlinks;
CREATE TRIGGER trg_wi_hyperlinks_changed_at BEFORE INSERT OR UPDATE ON public.work_item_hyperlinks
  FOR EACH ROW EXECUTE FUNCTION public.touch_changed_at();

-- ── What was deleted ─────────────────────────────────────────────────────────
-- A row's key, once the row is gone from an organization: deleted, or given
-- another key or organization (an item's id is renamed when its prefix is).
-- Kinds: item (work item id), backlog_rank and board_rank ("item|list"), hyperlink (id).
CREATE TABLE IF NOT EXISTS public.row_deletions (
  organization_id uuid NOT NULL,
  kind text NOT NULL,
  row_key text NOT NULL,
  deleted_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_row_deletions_org_at ON public.row_deletions (organization_id, deleted_at);
CREATE INDEX IF NOT EXISTS idx_row_deletions_at ON public.row_deletions (deleted_at);

ALTER TABLE public.row_deletions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "Org members can read deletions" ON public.row_deletions;
CREATE POLICY "Org members can read deletions" ON public.row_deletions FOR SELECT TO authenticated
  USING (is_member_of((SELECT current_user_id()), organization_id) OR is_superuser((SELECT current_user_id())));
GRANT SELECT ON public.row_deletions TO authenticated;
GRANT ALL ON public.row_deletions TO service_role;

-- Written by the triggers alone, whoever deleted: so as the table's owner.
CREATE OR REPLACE FUNCTION public.note_row_deletions()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_TABLE_NAME = 'work_items' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key)
    SELECT o.organization_id, 'item', o.id FROM old_rows o WHERE o.organization_id IS NOT NULL;
  ELSIF TG_TABLE_NAME = 'work_item_backlog_ranks' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key)
    SELECT o.organization_id, 'backlog_rank', o.work_item_id || '|' || o.backlog_id FROM old_rows o;
  ELSIF TG_TABLE_NAME = 'work_item_board_ranks' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key)
    SELECT o.organization_id, 'board_rank', o.work_item_id || '|' || o.backlog_id FROM old_rows o;
  ELSIF TG_TABLE_NAME = 'work_item_hyperlinks' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key)
    SELECT o.organization_id, 'hyperlink', o.id::text FROM old_rows o;
  END IF;
  RETURN NULL;
END;
$$;

-- A row that keeps existing under another key or organization is gone from the old one.
CREATE OR REPLACE FUNCTION public.note_row_rekeyed()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF OLD.organization_id IS NULL THEN RETURN NULL; END IF;
  IF TG_TABLE_NAME = 'work_items' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key) VALUES (OLD.organization_id, 'item', OLD.id);
  ELSIF TG_TABLE_NAME = 'work_item_backlog_ranks' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key) VALUES (OLD.organization_id, 'backlog_rank', OLD.work_item_id || '|' || OLD.backlog_id);
  ELSIF TG_TABLE_NAME = 'work_item_board_ranks' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key) VALUES (OLD.organization_id, 'board_rank', OLD.work_item_id || '|' || OLD.backlog_id);
  ELSIF TG_TABLE_NAME = 'work_item_hyperlinks' THEN
    INSERT INTO public.row_deletions (organization_id, kind, row_key) VALUES (OLD.organization_id, 'hyperlink', OLD.id::text);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_work_items_note_deletions ON public.work_items;
CREATE TRIGGER trg_work_items_note_deletions AFTER DELETE ON public.work_items
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.note_row_deletions();
DROP TRIGGER IF EXISTS trg_wibr_note_deletions ON public.work_item_backlog_ranks;
CREATE TRIGGER trg_wibr_note_deletions AFTER DELETE ON public.work_item_backlog_ranks
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.note_row_deletions();
DROP TRIGGER IF EXISTS trg_wibdr_note_deletions ON public.work_item_board_ranks;
CREATE TRIGGER trg_wibdr_note_deletions AFTER DELETE ON public.work_item_board_ranks
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.note_row_deletions();
DROP TRIGGER IF EXISTS trg_wi_hyperlinks_note_deletions ON public.work_item_hyperlinks;
CREATE TRIGGER trg_wi_hyperlinks_note_deletions AFTER DELETE ON public.work_item_hyperlinks
  REFERENCING OLD TABLE AS old_rows FOR EACH STATEMENT EXECUTE FUNCTION public.note_row_deletions();

DROP TRIGGER IF EXISTS trg_work_items_note_rekeyed ON public.work_items;
CREATE TRIGGER trg_work_items_note_rekeyed AFTER UPDATE OF id, organization_id ON public.work_items
  FOR EACH ROW WHEN (OLD.id IS DISTINCT FROM NEW.id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION public.note_row_rekeyed();
DROP TRIGGER IF EXISTS trg_wibr_note_rekeyed ON public.work_item_backlog_ranks;
CREATE TRIGGER trg_wibr_note_rekeyed AFTER UPDATE OF work_item_id, backlog_id, organization_id ON public.work_item_backlog_ranks
  FOR EACH ROW WHEN (OLD.work_item_id IS DISTINCT FROM NEW.work_item_id OR OLD.backlog_id IS DISTINCT FROM NEW.backlog_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION public.note_row_rekeyed();
DROP TRIGGER IF EXISTS trg_wibdr_note_rekeyed ON public.work_item_board_ranks;
CREATE TRIGGER trg_wibdr_note_rekeyed AFTER UPDATE OF work_item_id, backlog_id, organization_id ON public.work_item_board_ranks
  FOR EACH ROW WHEN (OLD.work_item_id IS DISTINCT FROM NEW.work_item_id OR OLD.backlog_id IS DISTINCT FROM NEW.backlog_id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION public.note_row_rekeyed();
DROP TRIGGER IF EXISTS trg_wi_hyperlinks_note_rekeyed ON public.work_item_hyperlinks;
CREATE TRIGGER trg_wi_hyperlinks_note_rekeyed AFTER UPDATE OF id, organization_id ON public.work_item_hyperlinks
  FOR EACH ROW WHEN (OLD.id IS DISTINCT FROM NEW.id OR OLD.organization_id IS DISTINCT FROM NEW.organization_id)
  EXECUTE FUNCTION public.note_row_rekeyed();

-- ── What changed, in one request ─────────────────────────────────────────────
-- Read as the caller: row-level security decides what is seen, as it does for
-- the full reads, and the counts are of the same rows those reads return.
-- Without _since, only the time and the counts: a full load starts with it.
CREATE OR REPLACE FUNCTION public.get_org_changes(_org_id uuid, _since timestamptz)
RETURNS json
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT json_build_object(
    'now', now(),
    'counts', json_build_object(
      'items', (SELECT count(*) FROM work_items WHERE organization_id = _org_id),
      'backlogRanks', (SELECT count(*) FROM work_item_backlog_ranks WHERE organization_id = _org_id),
      'boardRanks', (SELECT count(*) FROM work_item_board_ranks WHERE organization_id = _org_id),
      'hyperlinks', (SELECT count(*) FROM work_item_hyperlinks WHERE organization_id = _org_id)
    ),
    'items', CASE WHEN _since IS NULL THEN NULL ELSE (
      SELECT coalesce(json_agg(w), '[]'::json) FROM work_items w
      WHERE w.organization_id = _org_id AND w.changed_at > _since) END,
    'backlogRanks', CASE WHEN _since IS NULL THEN NULL ELSE (
      SELECT coalesce(json_agg(json_build_array(r.work_item_id, r.backlog_id, r.rank)), '[]'::json) FROM work_item_backlog_ranks r
      WHERE r.organization_id = _org_id AND r.changed_at > _since) END,
    'boardRanks', CASE WHEN _since IS NULL THEN NULL ELSE (
      SELECT coalesce(json_agg(json_build_array(r.work_item_id, r.backlog_id, r.rank)), '[]'::json) FROM work_item_board_ranks r
      WHERE r.organization_id = _org_id AND r.changed_at > _since) END,
    'hyperlinks', CASE WHEN _since IS NULL THEN NULL ELSE (
      SELECT coalesce(json_agg(json_build_object('id', h.id, 'work_item_id', h.work_item_id, 'url', h.url, 'alt_text', h.alt_text, 'rank', h.rank)), '[]'::json)
      FROM work_item_hyperlinks h WHERE h.organization_id = _org_id AND h.changed_at > _since) END,
    'deleted', CASE WHEN _since IS NULL THEN NULL ELSE (
      SELECT coalesce(json_agg(json_build_array(d.kind, d.row_key)), '[]'::json) FROM row_deletions d
      WHERE d.organization_id = _org_id AND d.deleted_at > _since) END
  );
$$;

REVOKE ALL ON FUNCTION public.get_org_changes(uuid, timestamptz) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.get_org_changes(uuid, timestamptz) TO authenticated, service_role;

-- ── A month of deletions is kept ─────────────────────────────────────────────
-- A browser's copy older than that is loaded in full instead (rowMirror.ts).
DO $cron$
BEGIN
  PERFORM cron.unschedule('row-deletions-prune') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'row-deletions-prune');
  PERFORM cron.schedule('row-deletions-prune', '40 3 * * *', $$DELETE FROM public.row_deletions WHERE deleted_at < now() - interval '30 days'$$);
END
$cron$;
