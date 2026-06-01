
-- 1) Make work-item-attachments bucket private and restrict read access
UPDATE storage.buckets SET public = false WHERE id = 'work-item-attachments';

DROP POLICY IF EXISTS "Work item attachments are publicly readable" ON storage.objects;

CREATE POLICY "Org members can view work item attachments"
ON storage.objects FOR SELECT
TO authenticated
USING (
  bucket_id = 'work-item-attachments'
  AND (
    public.is_member_of(auth.uid(), ((storage.foldername(name))[1])::uuid)
    OR public.is_superuser(auth.uid())
  )
);

-- 2) Tighten restore_organization_backup to admin/owner/superuser only
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
      DELETE FROM backlogs WHERE organization_id = _org_id AND id = ANY(_backlog_ids);
    END IF;
    IF _scope_type IN ('all','trees') AND array_length(_tree_ids,1) > 0 THEN
      DELETE FROM tree_statuses WHERE tree_id = ANY(_tree_ids);
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

        DELETE FROM tree_statuses WHERE tree_id = _rec.value->>'id';
      END LOOP;

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
        ON CONFLICT (tree_id, key) DO UPDATE SET
          label = EXCLUDED.label,
          color = EXCLUDED.color,
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

          DELETE FROM tree_statuses WHERE tree_id = _new_tree_id;

          INSERT INTO tree_statuses (tree_id, key, label, color, rank)
          SELECT _new_tree_id, ts->>'key', ts->>'label', ts->>'color', COALESCE((ts->>'rank')::int,0)
          FROM jsonb_array_elements(_snap->'tree_statuses') ts
          WHERE ts->>'tree_id' = _rec.value->>'id'
          ON CONFLICT (tree_id, key) DO NOTHING;
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
