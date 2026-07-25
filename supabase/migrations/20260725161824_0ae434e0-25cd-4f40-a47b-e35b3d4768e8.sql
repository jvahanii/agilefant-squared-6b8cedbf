
-- 1. Statement-level snapshot functions

CREATE OR REPLACE FUNCTION public.snapshot_work_items_insert_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _skip text;
BEGIN
  BEGIN _skip := current_setting('burnups.skip_history', true); EXCEPTION WHEN OTHERS THEN _skip := NULL; END;
  IF _skip = 'on' THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_history
    (work_item_id, organization_id, event, existed, title, status, points, parent_id, backlog_assignments)
  SELECT n.id, n.organization_id, 'insert', true, n.title, n.status, n.points, n.parent_id,
         COALESCE(n.backlog_assignments, '{}'::jsonb)
  FROM new_rows n;
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_work_items_update_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _skip text;
BEGIN
  BEGIN _skip := current_setting('burnups.skip_history', true); EXCEPTION WHEN OTHERS THEN _skip := NULL; END;
  IF _skip = 'on' THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_history
    (work_item_id, organization_id, event, existed, title, status, points, parent_id, backlog_assignments)
  SELECT n.id, n.organization_id, 'update', true, n.title, n.status, n.points, n.parent_id,
         COALESCE(n.backlog_assignments, '{}'::jsonb)
  FROM new_rows n
  JOIN old_rows o ON o.id = n.id
  WHERE n.status IS DISTINCT FROM o.status
     OR n.points IS DISTINCT FROM o.points
     OR n.parent_id IS DISTINCT FROM o.parent_id
     OR n.title IS DISTINCT FROM o.title
     OR COALESCE(n.backlog_assignments, '{}'::jsonb) IS DISTINCT FROM COALESCE(o.backlog_assignments, '{}'::jsonb);
  RETURN NULL;
END;
$$;

CREATE OR REPLACE FUNCTION public.snapshot_work_items_delete_stmt()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE _skip text;
BEGIN
  BEGIN _skip := current_setting('burnups.skip_history', true); EXCEPTION WHEN OTHERS THEN _skip := NULL; END;
  IF _skip = 'on' THEN RETURN NULL; END IF;

  INSERT INTO public.work_item_history
    (work_item_id, organization_id, event, existed, title, status, points, parent_id, backlog_assignments)
  SELECT o.id, o.organization_id, 'delete', false, o.title, o.status, o.points, o.parent_id,
         COALESCE(o.backlog_assignments, '{}'::jsonb)
  FROM old_rows o;
  RETURN NULL;
END;
$$;

-- 2. Replace row-level trigger with statement-level triggers
DROP TRIGGER IF EXISTS trg_work_items_snapshot ON public.work_items;

DROP TRIGGER IF EXISTS trg_work_items_snapshot_ins ON public.work_items;
DROP TRIGGER IF EXISTS trg_work_items_snapshot_upd ON public.work_items;
DROP TRIGGER IF EXISTS trg_work_items_snapshot_del ON public.work_items;

CREATE TRIGGER trg_work_items_snapshot_ins
AFTER INSERT ON public.work_items
REFERENCING NEW TABLE AS new_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.snapshot_work_items_insert_stmt();

CREATE TRIGGER trg_work_items_snapshot_upd
AFTER UPDATE ON public.work_items
REFERENCING NEW TABLE AS new_rows OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.snapshot_work_items_update_stmt();

CREATE TRIGGER trg_work_items_snapshot_del
AFTER DELETE ON public.work_items
REFERENCING OLD TABLE AS old_rows
FOR EACH STATEMENT
EXECUTE FUNCTION public.snapshot_work_items_delete_stmt();

-- 3. Bulk delete RPC that suppresses history for cascade deletes
CREATE OR REPLACE FUNCTION public.bulk_delete_work_items(_ids text[])
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
DECLARE
  _caller uuid;
  _deleted integer;
BEGIN
  _caller := auth.uid();
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

  PERFORM set_config('burnups.skip_history', 'on', true);
  DELETE FROM work_items WHERE id = ANY(_ids);
  GET DIAGNOSTICS _deleted = ROW_COUNT;
  RETURN _deleted;
END;
$$;

GRANT EXECUTE ON FUNCTION public.bulk_delete_work_items(text[]) TO authenticated;
GRANT EXECUTE ON FUNCTION public.bulk_delete_work_items(text[]) TO service_role;

-- 4. Add skip_history guard to existing bulk-churn functions
CREATE OR REPLACE FUNCTION public.remove_tree_share_with_copy(_share_id uuid)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _tree_id text;
  _org_id uuid;
  _new_tree_id text;
  _new_backlog_id text;
  _new_wi_id text;
  _rec record;
BEGIN
  PERFORM set_config('burnups.skip_history', 'on', true);

  SELECT tree_id, organization_id INTO _tree_id, _org_id
  FROM backlog_tree_shares
  WHERE id = _share_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Share not found';
  END IF;

  IF NOT is_tree_admin(auth.uid(), _tree_id) AND NOT is_superuser(auth.uid()) THEN
    RAISE EXCEPTION 'Permission denied';
  END IF;

  _new_tree_id := _org_id::text || '::' || gen_random_uuid()::text;

  INSERT INTO backlog_trees (id, name, organization_id, rank)
  SELECT _new_tree_id, name, _org_id, rank
  FROM backlog_trees
  WHERE id = _tree_id;

  CREATE TEMP TABLE _backlog_id_map (old_id text, new_id text) ON COMMIT DROP;

  FOR _rec IN
    SELECT id, name, parent_id, rank
    FROM backlogs
    WHERE tree_id = _tree_id
    ORDER BY rank
  LOOP
    _new_backlog_id := _org_id::text || '::' || gen_random_uuid()::text;
    INSERT INTO _backlog_id_map (old_id, new_id) VALUES (_rec.id, _new_backlog_id);

    INSERT INTO backlogs (id, name, tree_id, parent_id, rank, organization_id)
    VALUES (
      _new_backlog_id,
      _rec.name,
      _new_tree_id,
      NULL,
      _rec.rank,
      _org_id
    );
  END LOOP;

  UPDATE backlogs b
  SET parent_id = pm.new_id
  FROM _backlog_id_map bm
  JOIN backlogs orig ON orig.id = bm.old_id
  JOIN _backlog_id_map pm ON pm.old_id = orig.parent_id
  WHERE b.id = bm.new_id
    AND orig.parent_id IS NOT NULL;

  CREATE TEMP TABLE _wi_id_map (old_id text, new_id text) ON COMMIT DROP;

  FOR _rec IN
    SELECT id, title, description, points, status, parent_id, backlog_assignments, rank,
           respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at
    FROM work_items
    WHERE backlog_assignments ? _tree_id
    ORDER BY rank
  LOOP
    _new_wi_id := _org_id::text || '::' || gen_random_uuid()::text;
    INSERT INTO _wi_id_map (old_id, new_id) VALUES (_rec.id, _new_wi_id);

    INSERT INTO work_items (id, title, description, points, status, parent_id,
                            backlog_assignments, rank, organization_id,
                            respawn_enabled, respawn_interval_days, respawn_hour, respawn_minute, respawn_last_triggered_at)
    VALUES (
      _new_wi_id,
      _rec.title,
      _rec.description,
      _rec.points,
      _rec.status,
      NULL,
      jsonb_build_object(
        _new_tree_id,
        COALESCE(
          (SELECT new_id FROM _backlog_id_map WHERE old_id = (_rec.backlog_assignments ->> _tree_id)),
          _rec.backlog_assignments ->> _tree_id
        )
      ),
      _rec.rank,
      _org_id,
      _rec.respawn_enabled,
      _rec.respawn_interval_days,
      _rec.respawn_hour,
      _rec.respawn_minute,
      _rec.respawn_last_triggered_at
    );
  END LOOP;

  UPDATE work_items wi
  SET parent_id = wm.new_id
  FROM _wi_id_map wm_child
  JOIN work_items orig ON orig.id = wm_child.old_id
  JOIN _wi_id_map wm ON wm.old_id = orig.parent_id
  WHERE wi.id = wm_child.new_id
    AND orig.parent_id IS NOT NULL;

  DELETE FROM backlog_tree_shares WHERE id = _share_id;
END;
$function$;

CREATE OR REPLACE FUNCTION public.rename_work_items_org_prefix(_item_ids text[], _new_org_id uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
  _old_ids  text[]  := '{}';
  _new_ids  text[]  := '{}';
  _id_map   jsonb   := '{}';
  rec       RECORD;
  _old_id   text;
  _new_id   text;
BEGIN
  PERFORM set_config('burnups.skip_history', 'on', true);

  IF auth.uid() IS NOT NULL AND NOT is_superuser(auth.uid()) THEN
    IF NOT is_member_of(auth.uid(), _new_org_id) THEN
      RAISE EXCEPTION 'Permission denied: not a member of target org';
    END IF;
    IF EXISTS (
      SELECT 1
      FROM work_items wi
      WHERE wi.id = ANY(_item_ids)
        AND NOT is_member_of(auth.uid(), wi.organization_id)
    ) THEN
      RAISE EXCEPTION 'Permission denied: not a member of the item-owner org';
    END IF;
  END IF;

  FOR rec IN SELECT id FROM work_items WHERE id = ANY(_item_ids) LOOP
    _old_id := rec.id;
    IF strpos(_old_id, '::') > 0 THEN
      _new_id := _new_org_id::text || '::' || split_part(_old_id, '::', 2);
    ELSE
      _new_id := _new_org_id::text || '::' || _old_id;
    END IF;
    WHILE EXISTS (SELECT 1 FROM work_items WHERE id = _new_id) LOOP
      _new_id := _new_org_id::text || '::wi-' || substring(gen_random_uuid()::text, 1, 8);
    END LOOP;
    _old_ids := _old_ids || _old_id;
    _new_ids := _new_ids || _new_id;
    _id_map  := _id_map  || jsonb_build_object(_old_id, _new_id);
  END LOOP;

  IF array_length(_old_ids, 1) IS NULL THEN
    RETURN _id_map;
  END IF;

  INSERT INTO work_items (
    id, title, description, points, status,
    parent_id, backlog_assignments, rank, organization_id,
    respawn_enabled, respawn_interval_days, respawn_hour, respawn_last_triggered_at
  )
  SELECT
    _id_map ->> wi.id,
    wi.title, wi.description, wi.points, wi.status,
    NULL,
    wi.backlog_assignments, wi.rank, _new_org_id,
    wi.respawn_enabled, wi.respawn_interval_days, wi.respawn_hour, wi.respawn_last_triggered_at
  FROM work_items wi
  WHERE wi.id = ANY(_old_ids);

  UPDATE work_items child
  SET parent_id = _id_map ->> child.parent_id
  WHERE child.id = ANY(_new_ids)
    AND (SELECT parent_id FROM work_items orig WHERE orig.id = (
      SELECT key FROM jsonb_each_text(_id_map) WHERE value = child.id
    )) IS NOT NULL;

  UPDATE work_item_hyperlinks h
  SET work_item_id = _id_map ->> h.work_item_id
  WHERE h.work_item_id = ANY(_old_ids);

  UPDATE work_item_backlog_ranks r
  SET work_item_id = _id_map ->> r.work_item_id
  WHERE r.work_item_id = ANY(_old_ids);

  UPDATE work_item_team_assignments a
  SET work_item_id = _id_map ->> a.work_item_id
  WHERE a.work_item_id = ANY(_old_ids);

  UPDATE label_assignments la
  SET entity_id = _id_map ->> la.entity_id
  WHERE la.entity_type = 'work_item' AND la.entity_id = ANY(_old_ids);

  DELETE FROM work_items WHERE id = ANY(_old_ids);

  RETURN _id_map;
END;
$function$;

-- Add guard at the top of restore_organization_backup (wrap only the entry)
-- Full function body is long; we do this by replacing just the leading declaration block.
-- Simpler: re-create with PERFORM at the top by prefixing the existing body.
-- Instead, add via ALTER FUNCTION not possible — we redefine with same body plus prefix.

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
  PERFORM set_config('burnups.skip_history', 'on', true);
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
