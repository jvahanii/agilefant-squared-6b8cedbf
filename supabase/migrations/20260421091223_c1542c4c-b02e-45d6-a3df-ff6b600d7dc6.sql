-- Enable required extensions for scheduled backups
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Backups table
CREATE TABLE public.organization_backups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id uuid NOT NULL,
  created_at timestamp with time zone NOT NULL DEFAULT now(),
  created_by uuid,
  kind text NOT NULL DEFAULT 'auto' CHECK (kind IN ('auto','manual')),
  note text,
  size_bytes integer NOT NULL DEFAULT 0,
  snapshot jsonb NOT NULL
);

CREATE INDEX idx_org_backups_org_created ON public.organization_backups (organization_id, created_at DESC);

ALTER TABLE public.organization_backups ENABLE ROW LEVEL SECURITY;

-- Any org member (or superuser) can read backups
CREATE POLICY "Org members can read backups"
ON public.organization_backups
FOR SELECT
TO authenticated
USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Any org member (or superuser) can create backups
CREATE POLICY "Org members can insert backups"
ON public.organization_backups
FOR INSERT
TO authenticated
WITH CHECK (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Any org member (or superuser) can delete backups
CREATE POLICY "Org members can delete backups"
ON public.organization_backups
FOR DELETE
TO authenticated
USING (is_member_of(auth.uid(), organization_id) OR is_superuser(auth.uid()));

-- Trim backups: keep only last 30 days per organization
CREATE OR REPLACE FUNCTION public.trim_organization_backups()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM public.organization_backups
  WHERE organization_id = NEW.organization_id
    AND created_at < (now() - interval '30 days');
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_trim_organization_backups
AFTER INSERT ON public.organization_backups
FOR EACH ROW
EXECUTE FUNCTION public.trim_organization_backups();

-- Build a full JSONB snapshot for an organization
CREATE OR REPLACE FUNCTION public.build_organization_snapshot(_org_id uuid)
RETURNS jsonb
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT jsonb_build_object(
    'version', 1,
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
    'tree_statuses', COALESCE((
      SELECT jsonb_agg(to_jsonb(ts))
      FROM tree_statuses ts
      JOIN backlog_trees bt ON bt.id = ts.tree_id
      WHERE bt.organization_id = _org_id
    ), '[]'::jsonb)
  )
$$;

-- Create a backup row for an organization (used by cron and manual button)
CREATE OR REPLACE FUNCTION public.create_organization_backup(_org_id uuid, _kind text DEFAULT 'auto', _note text DEFAULT NULL)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _snap jsonb;
  _id uuid;
  _caller uuid;
BEGIN
  _caller := auth.uid();
  -- Permission check: org member or superuser OR invoked from cron (no auth.uid)
  IF _caller IS NOT NULL AND NOT (is_member_of(_caller, _org_id) OR is_superuser(_caller)) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  _snap := build_organization_snapshot(_org_id);

  INSERT INTO public.organization_backups (organization_id, created_by, kind, note, size_bytes, snapshot)
  VALUES (_org_id, _caller, COALESCE(_kind, 'auto'), _note, octet_length(_snap::text), _snap)
  RETURNING id INTO _id;

  RETURN _id;
END;
$$;

-- Restore from a backup with scope + mode
-- _scope: { "type": "all" } | { "type": "trees", "ids": [...] } | { "type": "backlogs", "ids": [...] }
-- _mode: 'overwrite' | 'merge' | 'copy'
CREATE OR REPLACE FUNCTION public.restore_organization_backup(
  _backup_id uuid,
  _scope jsonb DEFAULT '{"type":"all"}'::jsonb,
  _mode text DEFAULT 'merge'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
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

  IF _caller IS NULL OR NOT (is_member_of(_caller, _org_id) OR is_superuser(_caller)) THEN
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

  -- Compute affected tree_ids and backlog_ids and work_item_ids based on scope
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
  ELSE -- backlogs
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

  -- ========================================================
  -- MODE: overwrite  -> delete current rows in scope, re-insert from snapshot with original ids
  -- MODE: merge      -> upsert snapshot rows by id (no deletions of rows absent from snapshot)
  -- MODE: copy       -> everything gets new ids; names suffixed; never touches existing rows
  -- ========================================================

  IF _mode = 'overwrite' THEN
    -- Delete current data within the scope (org-scoped only)
    IF array_length(_work_item_ids,1) > 0 THEN
      DELETE FROM label_assignments WHERE organization_id = _org_id AND entity_type = 'work_item' AND entity_id = ANY(_work_item_ids);
      DELETE FROM work_item_hyperlinks WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_item_team_assignments WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_item_backlog_ranks WHERE organization_id = _org_id AND work_item_id = ANY(_work_item_ids);
      DELETE FROM work_items WHERE organization_id = _org_id AND id = ANY(_work_item_ids);
    END IF;
    IF array_length(_backlog_ids,1) > 0 THEN
      DELETE FROM label_assignments WHERE organization_id = _org_id AND entity_type = 'backlog' AND entity_id = ANY(_backlog_ids);
      DELETE FROM backlogs WHERE organization_id = _org_id AND id = ANY(_backlog_ids);
    END IF;
    IF _scope_type IN ('all','trees') AND array_length(_tree_ids,1) > 0 THEN
      DELETE FROM tree_statuses WHERE tree_id = ANY(_tree_ids);
      DELETE FROM backlog_trees WHERE organization_id = _org_id AND id = ANY(_tree_ids);
    END IF;
  END IF;

  IF _mode IN ('overwrite','merge') THEN
    -- Trees (only if scope includes trees, i.e. all or trees)
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

      -- Tree statuses
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'tree_statuses') ts WHERE (ts->>'tree_id') = ANY(_tree_ids)
      LOOP
        INSERT INTO tree_statuses (id, tree_id, key, label, color, rank)
        VALUES (
          (_rec.value->>'id')::uuid,
          _rec.value->>'tree_id',
          _rec.value->>'key',
          _rec.value->>'label',
          _rec.value->>'color',
          COALESCE((_rec.value->>'rank')::int, 0)
        )
        ON CONFLICT (id) DO UPDATE SET
          label = EXCLUDED.label,
          color = EXCLUDED.color,
          rank = EXCLUDED.rank;
      END LOOP;
    END IF;

    -- Backlogs: insert in two passes so parent refs resolve
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

    -- Work items: two passes for parent_id
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_items (id, title, description, points, status, parent_id, backlog_assignments, rank, organization_id,
                              respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at)
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
        respawn_last_triggered_at = EXCLUDED.respawn_last_triggered_at;
    END LOOP;
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids) AND (w->>'parent_id') IS NOT NULL
    LOOP
      UPDATE work_items SET parent_id = _rec.value->>'parent_id' WHERE id = _rec.value->>'id';
    END LOOP;

    -- Ranks
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_backlog_ranks') r
      WHERE (r->>'work_item_id') = ANY(_work_item_ids) AND (r->>'backlog_id') = ANY(_backlog_ids)
    LOOP
      INSERT INTO work_item_backlog_ranks (id, work_item_id, backlog_id, rank, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', _rec.value->>'backlog_id',
              COALESCE((_rec.value->>'rank')::int, 0), _org_id)
      ON CONFLICT (id) DO UPDATE SET rank = EXCLUDED.rank;
    END LOOP;

    -- Hyperlinks
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_hyperlinks') h WHERE (h->>'work_item_id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_item_hyperlinks (id, work_item_id, url, alt_text, rank, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', _rec.value->>'url',
              COALESCE(_rec.value->>'alt_text',''), COALESCE((_rec.value->>'rank')::int,0), _org_id)
      ON CONFLICT (id) DO UPDATE SET url = EXCLUDED.url, alt_text = EXCLUDED.alt_text, rank = EXCLUDED.rank;
    END LOOP;

    -- Team assignments
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_item_team_assignments') a WHERE (a->>'work_item_id') = ANY(_work_item_ids)
    LOOP
      INSERT INTO work_item_team_assignments (id, work_item_id, team_id, organization_id)
      VALUES ((_rec.value->>'id')::uuid, _rec.value->>'work_item_id', (_rec.value->>'team_id')::uuid, _org_id)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;

    -- Labels (only on 'all' scope to avoid partial label state)
    IF _scope_type = 'all' THEN
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'labels')
      LOOP
        INSERT INTO labels (id, name, color, organization_id)
        VALUES ((_rec.value->>'id')::uuid, _rec.value->>'name', COALESCE(_rec.value->>'color','#94a3b8'), _org_id)
        ON CONFLICT (id) DO UPDATE SET name = EXCLUDED.name, color = EXCLUDED.color;
      END LOOP;
    END IF;

    -- Label assignments within scope
    FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'label_assignments') la
      WHERE ((la->>'entity_type') = 'work_item' AND (la->>'entity_id') = ANY(_work_item_ids))
         OR ((la->>'entity_type') = 'backlog'   AND (la->>'entity_id') = ANY(_backlog_ids))
    LOOP
      INSERT INTO label_assignments (id, label_id, entity_type, entity_id, organization_id)
      VALUES ((_rec.value->>'id')::uuid, (_rec.value->>'label_id')::uuid,
              _rec.value->>'entity_type', _rec.value->>'entity_id', _org_id)
      ON CONFLICT (id) DO NOTHING;
    END LOOP;

  ELSE -- copy mode: new ids everywhere, names suffixed at tree/backlog level
    DECLARE
      _tree_map jsonb := '{}'::jsonb;
      _backlog_map jsonb := '{}'::jsonb;
      _wi_map jsonb := '{}'::jsonb;
      _suffix text := ' (restored ' || to_char(now(),'YYYY-MM-DD HH24:MI') || ')';
    BEGIN
      -- Trees
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlog_trees') t WHERE (t->>'id') = ANY(_tree_ids)
      LOOP
        _new_tree_id := _org_id::text || '::' || gen_random_uuid()::text;
        _tree_map := _tree_map || jsonb_build_object(_rec.value->>'id', _new_tree_id);
        INSERT INTO backlog_trees (id, name, organization_id, rank)
        VALUES (_new_tree_id,
                (_rec.value->>'name') || (CASE WHEN _scope_type IN ('all','trees') THEN _suffix ELSE '' END),
                _org_id,
                COALESCE((_rec.value->>'rank')::int, 0));

        -- Copy tree statuses for this tree
        INSERT INTO tree_statuses (tree_id, key, label, color, rank)
        SELECT _new_tree_id, ts->>'key', ts->>'label', ts->>'color', COALESCE((ts->>'rank')::int,0)
        FROM jsonb_array_elements(_snap->'tree_statuses') ts
        WHERE ts->>'tree_id' = _rec.value->>'id';
      END LOOP;

      -- Backlogs (first pass)
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
      -- Backlog parent fixup
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'backlogs') b WHERE (b->>'id') = ANY(_backlog_ids) AND (b->>'parent_id') IS NOT NULL
      LOOP
        UPDATE backlogs SET parent_id = COALESCE(_backlog_map->>(_rec.value->>'parent_id'), _rec.value->>'parent_id')
        WHERE id = _backlog_map->>(_rec.value->>'id');
      END LOOP;

      -- Work items (first pass) with remapped backlog_assignments
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids)
      LOOP
        _new_wi_id := _org_id::text || '::' || gen_random_uuid()::text;
        _wi_map := _wi_map || jsonb_build_object(_rec.value->>'id', _new_wi_id);

        INSERT INTO work_items (id, title, description, points, status, parent_id, backlog_assignments, rank, organization_id,
                                respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at)
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
          NULLIF(_rec.value->>'respawn_last_triggered_at','')::timestamptz;
      END LOOP;
      -- Work item parent fixup
      FOR _rec IN SELECT * FROM jsonb_array_elements(_snap->'work_items') w WHERE (w->>'id') = ANY(_work_item_ids) AND (w->>'parent_id') IS NOT NULL
      LOOP
        UPDATE work_items SET parent_id = COALESCE(_wi_map->>(_rec.value->>'parent_id'), _rec.value->>'parent_id')
        WHERE id = _wi_map->>(_rec.value->>'id');
      END LOOP;

      -- Ranks, hyperlinks, team assignments with remapped ids
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

      -- Label assignments (labels themselves keep their ids; only for existing labels in this org)
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
$$;
