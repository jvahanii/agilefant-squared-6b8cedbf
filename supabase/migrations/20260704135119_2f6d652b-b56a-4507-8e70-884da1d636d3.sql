
-- 1. Create backlog_statuses (per-backlog status definitions)
CREATE TABLE public.backlog_statuses (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  backlog_id TEXT NOT NULL REFERENCES public.backlogs(id) ON DELETE CASCADE,
  key TEXT NOT NULL,
  label TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT '#94a3b8',
  rank INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (backlog_id, key)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.backlog_statuses TO authenticated;
GRANT ALL ON public.backlog_statuses TO service_role;

ALTER TABLE public.backlog_statuses ENABLE ROW LEVEL SECURITY;

CREATE POLICY "select_backlog_statuses" ON public.backlog_statuses FOR SELECT
  USING (EXISTS (
    SELECT 1 FROM public.backlogs b
    WHERE b.id = backlog_id AND public.is_tree_accessible(auth.uid(), b.tree_id)
  ));
CREATE POLICY "insert_backlog_statuses" ON public.backlog_statuses FOR INSERT
  WITH CHECK (EXISTS (
    SELECT 1 FROM public.backlogs b
    WHERE b.id = backlog_id AND public.is_tree_accessible(auth.uid(), b.tree_id)
  ));
CREATE POLICY "update_backlog_statuses" ON public.backlog_statuses FOR UPDATE
  USING (EXISTS (
    SELECT 1 FROM public.backlogs b
    WHERE b.id = backlog_id AND public.is_tree_accessible(auth.uid(), b.tree_id)
  ));
CREATE POLICY "delete_backlog_statuses" ON public.backlog_statuses FOR DELETE
  USING (EXISTS (
    SELECT 1 FROM public.backlogs b
    WHERE b.id = backlog_id AND public.is_tree_accessible(auth.uid(), b.tree_id)
  ));

CREATE OR REPLACE FUNCTION public.touch_backlog_statuses_updated_at()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO 'public'
AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$;

CREATE TRIGGER touch_backlog_statuses_updated_at_trigger
  BEFORE UPDATE ON public.backlog_statuses
  FOR EACH ROW EXECUTE FUNCTION public.touch_backlog_statuses_updated_at();

-- 2. Seed root backlogs by copying tree_statuses, applying board_columns
--    (label + rank) overrides where present.
INSERT INTO public.backlog_statuses (backlog_id, key, label, color, rank)
SELECT
  b.id,
  ts.key,
  COALESCE(bc.label, ts.label) AS label,
  ts.color,
  COALESCE(bc.rank, ts.rank) AS rank
FROM public.backlogs b
JOIN public.tree_statuses ts ON ts.tree_id = b.tree_id
LEFT JOIN public.board_columns bc
  ON bc.backlog_id = b.id AND bc.status_key = ts.key
WHERE b.parent_id IS NULL
ON CONFLICT (backlog_id, key) DO NOTHING;

-- 3. Sub-backlogs with custom board_columns: materialize as own status set.
INSERT INTO public.backlog_statuses (backlog_id, key, label, color, rank)
SELECT
  bc.backlog_id,
  bc.status_key,
  bc.label,
  COALESCE(ts.color, '#94a3b8'),
  bc.rank
FROM public.board_columns bc
JOIN public.backlogs b ON b.id = bc.backlog_id
LEFT JOIN public.tree_statuses ts
  ON ts.tree_id = b.tree_id AND ts.key = bc.status_key
WHERE b.parent_id IS NOT NULL
ON CONFLICT (backlog_id, key) DO NOTHING;

-- Ensure those sub-backlogs still get the required pinned statuses.
INSERT INTO public.backlog_statuses (backlog_id, key, label, color, rank)
SELECT DISTINCT bc.backlog_id, seed.key, seed.label, seed.color, seed.rank
FROM public.board_columns bc
JOIN public.backlogs b ON b.id = bc.backlog_id
CROSS JOIN (VALUES
  ('not_started', 'Not Started', '#94a3b8', 0),
  ('in_progress', 'In Progress', '#f97316', 1),
  ('done', 'Done', '#22c55e', 999)
) AS seed(key, label, color, rank)
WHERE b.parent_id IS NOT NULL
ON CONFLICT (backlog_id, key) DO NOTHING;

-- 4. Add backlog_statuses to realtime publication
ALTER PUBLICATION supabase_realtime ADD TABLE public.backlog_statuses;

-- 5. Rewrite backup/restore functions that reference the old tables so they
--    keep working after we drop tree_statuses / board_columns.
CREATE OR REPLACE FUNCTION public.build_organization_snapshot(_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _caller uuid;
BEGIN
  _caller := auth.uid();
  IF _caller IS NOT NULL AND NOT (
    is_member_of(_caller, _org_id) OR is_superuser(_caller)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  RETURN jsonb_build_object(
    'version', 2,
    'generated_at', now(),
    'organization_id', _org_id,
    'backlog_trees', COALESCE((SELECT jsonb_agg(to_jsonb(t)) FROM backlog_trees t WHERE t.organization_id = _org_id), '[]'::jsonb),
    'backlogs', COALESCE((SELECT jsonb_agg(to_jsonb(b)) FROM backlogs b WHERE b.organization_id = _org_id), '[]'::jsonb),
    'work_items', COALESCE((SELECT jsonb_agg(to_jsonb(w)) FROM work_items w WHERE w.organization_id = _org_id), '[]'::jsonb),
    'work_item_backlog_ranks', COALESCE((SELECT jsonb_agg(to_jsonb(r)) FROM work_item_backlog_ranks r WHERE r.organization_id = _org_id), '[]'::jsonb),
    'work_item_hyperlinks', COALESCE((SELECT jsonb_agg(to_jsonb(h)) FROM work_item_hyperlinks h WHERE h.organization_id = _org_id), '[]'::jsonb),
    'work_item_team_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(a)) FROM work_item_team_assignments a WHERE a.organization_id = _org_id), '[]'::jsonb),
    'labels', COALESCE((SELECT jsonb_agg(to_jsonb(l)) FROM labels l WHERE l.organization_id = _org_id), '[]'::jsonb),
    'label_assignments', COALESCE((SELECT jsonb_agg(to_jsonb(la)) FROM label_assignments la WHERE la.organization_id = _org_id), '[]'::jsonb),
    'backlog_statuses', COALESCE((
      SELECT jsonb_agg(to_jsonb(bs))
      FROM backlog_statuses bs
      JOIN backlogs b ON b.id = bs.backlog_id
      WHERE b.organization_id = _org_id
    ), '[]'::jsonb)
  );
END;
$function$;

CREATE OR REPLACE FUNCTION public.restore_organization_backup(_backup_id uuid, _scope jsonb DEFAULT '{"type": "all"}'::jsonb, _mode text DEFAULT 'merge'::text)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _org_id uuid;
  _snap jsonb;
  _caller uuid;
  _scope_type text;
  _scope_ids text[];
  _tree_ids text[];
  _backlog_ids text[];
  _work_item_ids text[];
  _counts jsonb := '{}'::jsonb;
  _new_tree_id text;
  _new_backlog_id text;
  _new_wi_id text;
  _rec record;
BEGIN
  _caller := auth.uid();

  SELECT organization_id, snapshot INTO _org_id, _snap
  FROM public.organization_backups
  WHERE id = _backup_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Backup not found';
  END IF;

  IF _caller IS NULL OR NOT (
    has_org_role(_caller, _org_id, 'owner'::app_role)
    OR has_org_role(_caller, _org_id, 'admin'::app_role)
    OR is_superuser(_caller)
  ) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  IF _mode NOT IN ('overwrite','merge','copy') THEN
    RAISE EXCEPTION 'Invalid mode: %', _mode;
  END IF;

  _scope_type := COALESCE(_scope->>'type', 'all');
  IF _scope_type NOT IN ('all','trees','backlogs') THEN
    RAISE EXCEPTION 'Invalid scope type: %', _scope_type;
  END IF;

  IF _scope_type IN ('trees','backlogs') THEN
    SELECT array_agg(x) INTO _scope_ids FROM jsonb_array_elements_text(COALESCE(_scope->'ids','[]'::jsonb)) x;
    IF _scope_ids IS NULL OR array_length(_scope_ids,1) = 0 THEN
      RAISE EXCEPTION 'Scope ids required for scope type %', _scope_type;
    END IF;
  END IF;

  IF _scope_type = 'all' THEN
    SELECT array_agg(t->>'id') INTO _tree_ids FROM jsonb_array_elements(_snap->'backlog_trees') t;
    SELECT array_agg(b->>'id') INTO _backlog_ids FROM jsonb_array_elements(_snap->'backlogs') b;
    SELECT array_agg(w->>'id') INTO _work_item_ids FROM jsonb_array_elements(_snap->'work_items') w;
  ELSIF _scope_type = 'trees' THEN
    _tree_ids := _scope_ids;
    SELECT array_agg(b->>'id') INTO _backlog_ids
    FROM jsonb_array_elements(_snap->'backlogs') b
    WHERE (b->>'tree_id') = ANY(_tree_ids);
    SELECT array_agg(w->>'id') INTO _work_item_ids
    FROM jsonb_array_elements(_snap->'work_items') w
    WHERE EXISTS (SELECT 1 FROM unnest(_tree_ids) tid WHERE (w->'backlog_assignments') ? tid);
  ELSE
    _backlog_ids := _scope_ids;
    SELECT array_agg(DISTINCT b->>'tree_id') INTO _tree_ids
    FROM jsonb_array_elements(_snap->'backlogs') b
    WHERE (b->>'id') = ANY(_backlog_ids);
    SELECT array_agg(w->>'id') INTO _work_item_ids
    FROM jsonb_array_elements(_snap->'work_items') w
    WHERE EXISTS (
      SELECT 1 FROM jsonb_each_text(w->'backlog_assignments') kv
      WHERE kv.value = ANY(_backlog_ids)
    );
  END IF;

  _tree_ids := COALESCE(_tree_ids, ARRAY[]::text[]);
  _backlog_ids := COALESCE(_backlog_ids, ARRAY[]::text[]);
  _work_item_ids := COALESCE(_work_item_ids, ARRAY[]::text[]);

  IF _mode = 'overwrite' THEN
    IF array_length(_work_item_ids,1) > 0 THEN
      DELETE FROM label_assignments WHERE organization_id = _org_id AND entity_type = 'work_item' AND entity_id = ANY(_work_item_ids);
      DELETE FROM work_item_hyperlinks WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_item_team_assignments WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_item_backlog_ranks WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_items WHERE organization_id = _org_id AND id = ANY(_work_item_ids);
    END IF;
    IF array_length(_backlog_ids,1) > 0 THEN
      DELETE FROM work_item_backlog_ranks WHERE organization_id = _org_id AND backlog_id = ANY(_backlog_ids);
      DELETE FROM label_assignments WHERE organization_id = _org_id AND entity_type = 'backlog' AND entity_id = ANY(_backlog_ids);
      DELETE FROM backlog_statuses WHERE backlog_id = ANY(_backlog_ids);
      DELETE FROM backlogs WHERE organization_id = _org_id AND id = ANY(_backlog_ids);
    END IF;
    IF _scope_type IN ('all','trees') AND array_length(_tree_ids,1) > 0 THEN
      DELETE FROM backlog_tree_shares WHERE tree_id = ANY(_tree_ids);
      DELETE FROM backlog_trees WHERE organization_id = _org_id AND id = ANY(_tree_ids);
    END IF;
  END IF;

  IF _mode IN ('overwrite','merge') THEN
    IF _scope_type IN ('all','trees') THEN
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_trees') t WHERE (t->>'id') = ANY(_tree_ids)
      LOOP
        INSERT INTO backlog_trees (id, name, organization_id, rank)
        VALUES (
          _rec.value->>'id',
          _rec.value->>'name',
          _org_id,
          COALESCE((_rec.value->>'rank')::int, 0)
        )
        ON CONFLICT (id) DO UPDATE SET
          name = EXCLUDED.name,
          rank = EXCLUDED.rank;
      END LOOP;
    END IF;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids)
    LOOP
      INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
      VALUES (
        _rec.value->>'id',
        _rec.value->>'name',
        _rec.value->>'tree_id',
        NULL,
        COALESCE((_rec.value->>'rank')::int, 0),
        _org_id
      )
      ON CONFLICT (id) DO UPDATE SET
        name = EXCLUDED.name,
        tree_id = EXCLUDED.tree_id,
        rank = EXCLUDED.rank;
    END LOOP;
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids) AND (b->>'parent_id') IS NOT NULL
    LOOP
      UPDATE backlogs SET parent_id = _rec.value->>'parent_id' WHERE id = _rec.value->>'id';
    END LOOP;

    -- Backlog statuses (only present in v2+ snapshots)
    IF _snap ? 'backlog_statuses' THEN
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_statuses') bs WHERE (bs->>'backlog_id') = ANY(_backlog_ids)
      LOOP
        INSERT INTO backlog_statuses (id, backlog_id, key, label, color, rank)
        VALUES (
          (_rec.value->>'id')::uuid,
          _rec.value->>'backlog_id',
          _rec.value->>'key',
          _rec.value->>'label',
          _rec.value->>'color',
          COALESCE((_rec.value->>'rank')::int, 0)
        )
        ON CONFLICT (backlog_id, key) DO UPDATE SET
          label = EXCLUDED.label,
          color = EXCLUDED.color,
          rank = EXCLUDED.rank;
      END LOOP;
    END IF;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_items (id, title, description, points, status, parent_id, backlog_assignments, rank, organization_id,
                              respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at)
      VALUES (
        _rec.value->>'id',
        _rec.value->>'title',
        _rec.value->>'description',
        NULLIF(_rec.value->>'points','')::int,
        COALESCE(_rec.value->>'status','not_started'),
        NULL,
        COALESCE(_rec.value->'backlog_assignments','{}'::jsonb),
        COALESCE((_rec.value->>'rank')::int, 0),
        _org_id,
        COALESCE((_rec.value->>'respawn_enabled')::boolean, false),
        NULLIF(_rec.value->>'respawn_interval_days','')::int,
        NULLIF(_rec.value->>'respawn_hour','')::int,
        NULLIF(_rec.value->>'respawn_minute','')::int,
        NULLIF(_rec.value->>'respawn_last_triggered_at','')::timestamptz
      )
      ON CONFLICT (id) DO UPDATE SET
        title = EXCLUDED.title,
        description = EXCLUDED.description,
        points = EXCLUDED.points,
        status = EXCLUDED.status,
        backlog_assignments = EXCLUDED.backlog_assignments,
        rank = EXCLUDED.rank,
        respawn_enabled = EXCLUDED.respawn_enabled,
        respawn_interval_days = EXCLUDED.respawn_interval_days,
        respawn_hour = EXCLUDED.respawn_hour,
        respawn_minute = EXCLUDED.respawn_minute,
        respawn_last_triggered_at = EXCLUDED.respawn_last_triggered_at;
    END LOOP;
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids) AND (w->>'parent_id') IS NOT NULL
    LOOP
      UPDATE work_items SET parent_id = _rec.value->>'parent_id' WHERE id = _rec.value->>'id';
    END LOOP;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_backlog_ranks') r
      WHERE (r->>'work_item_id') = ANY(_work_item_ids) AND (r->>'backlog_id') = ANY(_backlog_ids)
    LOOP
      INSERT INTO work_item_backlog_ranks (id, work_item_id, backlog_id, rank, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', _rec.value->>'backlog_id',
              COALESCE((_rec.value->>'rank')::int, 0), _org_id)
      ON CONFLICT (id) DO UPDATE SET rank = EXCLUDED.rank;
    END LOOP;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_hyperlinks') h WHERE (h->>'work_item_id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_item_hyperlinks (id, work_item_id, url, alt_text, rank, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', _rec.value->>'url',
              COALESCE(_rec.value->>'alt_text',''), COALESCE((_rec.value->>'rank')::int,0), _org_id)
      ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, alt_text = EXCLUDED.alt_text, rank = EXCLUDED.rank;
    END LOOP;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_team_assignments') a WHERE (a->>'work_item_id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_item_team_assignments (id, work_item_id, team_id, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', (_rec.value->>'team_id')::uuid, _org_id)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;

    IF _scope_type = 'all' THEN
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'labels')
      LOOP
        INSERT INTO labels (id, name, color, organization_id)
        VALUES ((_rec.value->>'id')::uuid, _rec.value->>'name', COALESCE(_rec.value->>'color','#94a3b8'), _org_id)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
      END LOOP;
    END IF;

    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'label_assignments') la
      WHERE ((la->>'entity_type') = 'work_item' AND (la->>'entity_id') = ANY(_work_item_ids))
         OR ((la->>'entity_type') = 'backlog'   AND (la->>'entity_id') = ANY(_backlog_ids))
    LOOP
      INSERT INTO label_assignments (id, label_id, entity_type, entity_id, organization_id)
      VALUES ((_rec.value->>'id')::uuid, (_rec.value->>'label_id')::uuid,
              _rec.value->>'entity_type', _rec.value->>'entity_id', _org_id)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;

  ELSE
    -- copy mode: skipped for backlog_statuses; user gets defaults on new backlogs via trigger.
    DECLARE
      _tree_map jsonb := '{}'::jsonb;
      _backlog_map jsonb := '{}'::jsonb;
      _wi_map jsonb := '{}'::jsonb;
      _suffix text := ' (restored ' || to_char(now(),'YYYY-MM-DD HH24:MI') || ')';
      _create_new_trees boolean := (_scope_type IN ('all','trees'));
    BEGIN
      IF _create_new_trees THEN
        FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_trees') t WHERE (t->>'id') = ANY(_tree_ids)
        LOOP
          _new_tree_id := _org_id::text || '::' || gen_random_uuid()::text;
          _tree_map := _tree_map || jsonb_build_object(_rec.value->>'id', _new_tree_id);
          INSERT INTO backlog_trees (id, name, organization_id, rank)
          VALUES (_new_tree_id,
                  (_rec.value->>'name') || _suffix,
                  _org_id,
                  COALESCE((_rec.value->>'rank')::int, 0));
        END LOOP;
      END IF;

      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids)
      LOOP
        _new_backlog_id := _org_id::text || '::' || gen_random_uuid()::text;
        _backlog_map := _backlog_map || jsonb_build_object(_rec.value->>'id', _new_backlog_id);
        INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
        VALUES (_new_backlog_id,
                (_rec.value->>'name') || (CASE WHEN _scope_type = 'backlogs' THEN _suffix ELSE '' END),
                COALESCE(_tree_map->>(_rec.value->>'tree_id'), _rec.value->>'tree_id'),
                NULL,
                COALESCE((_rec.value->>'rank')::int, 0),
                _org_id);
      END LOOP;
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids) AND (b->>'parent_id') IS NOT NULL
      LOOP
        UPDATE backlogs SET parent_id = COALESCE(_backlog_map->>(_rec.value->>'parent_id'), _rec.value->>'parent_id')
        WHERE id = _backlog_map->>(_rec.value->>'id');
      END LOOP;

      -- Copy backlog_statuses under new backlog IDs (v2+ snapshots)
      IF _snap ? 'backlog_statuses' THEN
        FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_statuses') bs WHERE (bs->>'backlog_id') = ANY(_backlog_ids)
        LOOP
          INSERT INTO backlog_statuses (backlog_id, key, label, color, rank)
          VALUES (
            _backlog_map->>(_rec.value->>'backlog_id'),
            _rec.value->>'key',
            _rec.value->>'label',
            _rec.value->>'color',
            COALESCE((_rec.value->>'rank')::int, 0)
          )
          ON CONFLICT (backlog_id, key) DO UPDATE SET
            label = EXCLUDED.label,
            color = EXCLUDED.color,
            rank = EXCLUDED.rank;
        END LOOP;
      END IF;

      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids)
      LOOP
        _new_wi_id := _org_id::text || '::' || gen_random_uuid()::text;
        _wi_map := _wi_map || jsonb_build_object(_rec.value->>'id', _new_wi_id);

        INSERT INTO work_items (id, title, description, points, status, parent_id, backlog_assignments, rank, organization_id,
                                respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at)
        SELECT
          _new_wi_id,
          _rec.value->>'title',
          _rec.value->>'description',
          NULLIF(_rec.value->>'points','')::int,
          COALESCE(_rec.value->>'status','not_started'),
          NULL,
          COALESCE((
            SELECT jsonb_object_agg(
              COALESCE(_tree_map->>kv.key, kv.key),
              COALESCE(_backlog_map->>kv.value, kv.value)
            )
            FROM jsonb_each_text(_rec.value->'backlog_assignments') kv
          ), '{}'::jsonb),
          COALESCE((_rec.value->>'rank')::int, 0),
          _org_id,
          COALESCE((_rec.value->>'respawn_enabled')::boolean, false),
          NULLIF(_rec.value->>'respawn_interval_days','')::int,
          NULLIF(_rec.value->>'respawn_hour','')::int,
          NULLIF(_rec.value->>'respawn_minute','')::int,
          NULLIF(_rec.value->>'respawn_last_triggered_at','')::timestamptz;
      END LOOP;
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids) AND (w->>'parent_id') IS NOT NULL
      LOOP
        UPDATE work_items SET parent_id = COALESCE(_wi_map->>(_rec.value->>'parent_id'), _rec.value->>'parent_id')
        WHERE id = _wi_map->>(_rec.value->>'id');
      END LOOP;

      INSERT INTO work_item_backlog_ranks (work_item_id, backlog_id, rank, organization_id)
      SELECT
        _wi_map->>(r->>'work_item_id'),
        COALESCE(_backlog_map->>(r->>'backlog_id'), r->>'backlog_id'),
        COALESCE((r->>'rank')::int, 0),
        _org_id
      FROM jsonb_array_elements(_snap->'work_item_backlog_ranks') r
      WHERE (r->>'work_item_id') = ANY(_work_item_ids)
        AND (r->>'backlog_id') = ANY(_backlog_ids);

      INSERT INTO work_item_hyperlinks (work_item_id, url, alt_text, rank, organization_id)
      SELECT _wi_map->>(h->>'work_item_id'),
             h->>'url',
             COALESCE(h->>'alt_text',''),
             COALESCE((h->>'rank')::int,0),
             _org_id
      FROM jsonb_array_elements(_snap->'work_item_hyperlinks') h
      WHERE (h->>'work_item_id') = ANY(_work_item_ids);

      INSERT INTO work_item_team_assignments (work_item_id, team_id, organization_id)
      SELECT _wi_map->>(a->>'work_item_id'), (a->>'team_id')::uuid, _org_id
      FROM jsonb_array_elements(_snap->'work_item_team_assignments') a
      WHERE (a->>'work_item_id') = ANY(_work_item_ids);

      INSERT INTO label_assignments (label_id, entity_type, entity_id, organization_id)
      SELECT
        (la->>'label_id')::uuid,
        la->>'entity_type',
        CASE la->>'entity_type'
          WHEN 'work_item' THEN _wi_map->>(la->>'entity_id')
          WHEN 'backlog'   THEN COALESCE(_backlog_map->>(la->>'entity_id'), la->>'entity_id')
        END,
        _org_id
      FROM jsonb_array_elements(_snap->'label_assignments') la
      WHERE EXISTS (SELECT 1 FROM labels l WHERE l.id = (la->>'label_id')::uuid AND l.organization_id = _org_id)
        AND (
             ((la->>'entity_type') = 'work_item' AND (la->>'entity_id') = ANY(_work_item_ids))
          OR ((la->>'entity_type') = 'backlog'   AND (la->>'entity_id') = ANY(_backlog_ids))
        );
    END;
  END IF;

  _counts := jsonb_build_object(
    'trees', array_length(_tree_ids,1),
    'backlogs', array_length(_backlog_ids,1),
    'work_items', array_length(_work_item_ids,1),
    'mode', _mode,
    'scope', _scope_type
  );

  RETURN _counts;
END;
$function$;

-- 6. Drop old status/column tables and the legacy hidden-status-keys column.
DROP TRIGGER IF EXISTS seed_default_tree_statuses_on_backlog_tree ON public.backlog_trees;
DROP TRIGGER IF EXISTS backlog_trees_seed_statuses ON public.backlog_trees;
DROP FUNCTION IF EXISTS public.seed_default_tree_statuses() CASCADE;
DROP FUNCTION IF EXISTS public.touch_tree_statuses_updated_at() CASCADE;

ALTER PUBLICATION supabase_realtime DROP TABLE public.tree_statuses;
ALTER PUBLICATION supabase_realtime DROP TABLE public.board_columns;

DROP TABLE IF EXISTS public.board_columns CASCADE;
DROP TABLE IF EXISTS public.tree_statuses CASCADE;

ALTER TABLE public.backlogs DROP COLUMN IF EXISTS board_hidden_status_keys;

-- 7. Trigger: auto-seed pinned statuses when a NEW backlog is created.
--    Only seeds root backlogs — sub-backlogs inherit until customized.
CREATE OR REPLACE FUNCTION public.seed_pinned_backlog_statuses()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  IF NEW.parent_id IS NULL THEN
    INSERT INTO public.backlog_statuses (backlog_id, key, label, color, rank) VALUES
      (NEW.id, 'not_started', 'Not Started', '#94a3b8', 0),
      (NEW.id, 'in_progress', 'In Progress', '#f97316', 1),
      (NEW.id, 'pending',     'Pending',     '#93c5fd', 2),
      (NEW.id, 'blocked',     'Blocked',     '#ef4444', 3),
      (NEW.id, 'done',        'Done',        '#22c55e', 4)
    ON CONFLICT (backlog_id, key) DO NOTHING;
  END IF;
  RETURN NEW;
END;
$function$;

CREATE TRIGGER seed_pinned_backlog_statuses_trigger
  AFTER INSERT ON public.backlogs
  FOR EACH ROW EXECUTE FUNCTION public.seed_pinned_backlog_statuses();
