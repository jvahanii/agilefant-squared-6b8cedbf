-- Live updates by broadcast instead of Postgres changes (2026-11-17).
--
-- With Postgres changes, Realtime polls the database for changes and checks
-- each against every subscription, around the clock: by far the largest use
-- of database time here (100,000+ polls since 13 November), on an instance
-- that was swapping itself out of its disk budget and went down twice.
--
-- Now a trigger on each table the app listens to sends one message per
-- change, through realtime.send(), to the private channel of each
-- organisation it concerns: org:<id> for the row's organisation, and, for a
-- row in a shared tree, for the tree's owner and every organisation it is
-- shared with. A snooze goes to its person's channel, user:<id>. A row whose
-- contents must not reach every member (public link tokens, the names behind
-- scrambled items and lists, Jira links and connections) is sent without
-- them: the app reloads those, as it did. Nothing is polled.
--
-- Who may listen is a rule on realtime.messages: members of the organisation,
-- the person themselves, and superusers. The app falls back to Postgres
-- changes if a channel is refused, so the publication stays as it is.
--
-- A transaction that changes many rows at once and has the app reload after
-- (a public list copied in) can set agilefant.quiet to 'on' and send nothing.

-- The organisations a tree's rows concern: its owner and those it is shared with.
CREATE OR REPLACE FUNCTION public.realtime_tree_orgs(_tree_ids text[])
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(DISTINCT x.o), '{}') FROM (
    SELECT t.organization_id AS o FROM public.backlog_trees t WHERE t.id = ANY(_tree_ids)
    UNION
    SELECT s.organization_id FROM public.backlog_tree_shares s WHERE s.tree_id = ANY(_tree_ids)
  ) x WHERE x.o IS NOT NULL
$function$;

-- The organisations that share trees with this one, either way.
CREATE OR REPLACE FUNCTION public.realtime_partner_orgs(_org uuid)
RETURNS uuid[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(DISTINCT x.o), '{}') FROM (
    SELECT s.organization_id AS o
      FROM public.backlog_tree_shares s JOIN public.backlog_trees t ON t.id = s.tree_id
     WHERE t.organization_id = _org
    UNION
    SELECT t.organization_id
      FROM public.backlog_tree_shares s JOIN public.backlog_trees t ON t.id = s.tree_id
     WHERE s.organization_id = _org
  ) x WHERE x.o IS NOT NULL AND x.o <> _org
$function$;

-- The trees an item is in.
CREATE OR REPLACE FUNCTION public.realtime_item_trees(_work_item_id text)
RETURNS text[]
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT coalesce(array_agg(k), '{}')
    FROM public.work_items w, jsonb_object_keys(coalesce(w.backlog_assignments, '{}'::jsonb)) k
   WHERE w.id = _work_item_id
$function$;

CREATE OR REPLACE FUNCTION public.broadcast_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _row jsonb;
  _org uuid;
  _trees text[];
  _orgs uuid[];
  _payload jsonb;
  _o uuid;
BEGIN
  IF current_setting('agilefant.quiet', true) = 'on' THEN
    RETURN NULL;
  END IF;
  _row := CASE WHEN TG_OP = 'DELETE' THEN to_jsonb(OLD) ELSE to_jsonb(NEW) END;

  IF TG_TABLE_NAME = 'work_item_snoozes' THEN
    IF _row ->> 'user_id' IS NOT NULL THEN
      PERFORM realtime.send(jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'row', _row),
                            'change', 'user:' || (_row ->> 'user_id'), true);
    END IF;
    RETURN NULL;
  END IF;

  _org := (_row ->> 'organization_id')::uuid;
  CASE TG_TABLE_NAME
    WHEN 'backlog_statuses' THEN
      SELECT b.organization_id, ARRAY[b.tree_id] INTO _org, _trees
        FROM public.backlogs b WHERE b.id = _row ->> 'backlog_id';
    WHEN 'work_items' THEN
      _trees := ARRAY(SELECT jsonb_object_keys(coalesce(_row -> 'backlog_assignments', '{}'::jsonb)));
      IF TG_OP = 'UPDATE' THEN
        _trees := _trees || ARRAY(SELECT jsonb_object_keys(coalesce(to_jsonb(OLD) -> 'backlog_assignments', '{}'::jsonb)));
      END IF;
    WHEN 'backlogs', 'tree_financial_targets', 'backlog_tree_shares' THEN
      _trees := ARRAY[_row ->> 'tree_id'];
    WHEN 'time_entries' THEN
      _trees := array_remove(ARRAY[_row ->> 'tree_id'], NULL) || public.realtime_item_trees(_row ->> 'work_item_id');
    WHEN 'work_item_hyperlinks', 'work_item_backlog_ranks', 'work_item_board_ranks',
         'work_item_financials', 'work_item_team_assignments' THEN
      _trees := public.realtime_item_trees(_row ->> 'work_item_id');
    WHEN 'label_assignments' THEN
      IF _row ->> 'entity_type' = 'work_item' THEN
        _trees := public.realtime_item_trees(_row ->> 'entity_id');
      END IF;
    ELSE
      NULL;
  END CASE;

  IF TG_TABLE_NAME IN ('published_links', 'work_item_scrambles', 'backlog_scrambles', 'jira_issue_links', 'jira_connections') THEN
    _payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP);
  ELSE
    _payload := jsonb_build_object('table', TG_TABLE_NAME, 'op', TG_OP, 'row', _row);
  END IF;

  _orgs := ARRAY[_org];
  IF TG_TABLE_NAME IN ('teams', 'labels') THEN
    _orgs := _orgs || public.realtime_partner_orgs(_org);
  ELSIF TG_TABLE_NAME NOT IN ('backlog_trees', 'organization_settings') AND coalesce(array_length(_trees, 1), 0) > 0 THEN
    _orgs := _orgs || public.realtime_tree_orgs(_trees);
  END IF;

  FOR _o IN SELECT DISTINCT x FROM unnest(_orgs) AS x WHERE x IS NOT NULL LOOP
    PERFORM realtime.send(_payload, 'change', 'org:' || _o::text, true);
  END LOOP;
  RETURN NULL;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.broadcast_change() FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.realtime_tree_orgs(text[]) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.realtime_partner_orgs(uuid) FROM PUBLIC, anon, authenticated;
REVOKE EXECUTE ON FUNCTION public.realtime_item_trees(text) FROM PUBLIC, anon, authenticated;

DO $do$
DECLARE
  _t text;
BEGIN
  FOREACH _t IN ARRAY ARRAY[
    'work_items', 'backlogs', 'backlog_trees', 'work_item_hyperlinks', 'work_item_backlog_ranks',
    'work_item_board_ranks', 'time_entries', 'work_item_team_assignments', 'teams', 'work_item_financials',
    'organization_settings', 'labels', 'label_assignments', 'backlog_statuses', 'published_links',
    'work_item_scrambles', 'jira_issue_links', 'jira_connections', 'backlog_scrambles',
    'tree_financial_targets', 'work_item_snoozes', 'backlog_tree_shares']
  LOOP
    EXECUTE format('DROP TRIGGER IF EXISTS trg_broadcast_change ON public.%I', _t);
    EXECUTE format('CREATE TRIGGER trg_broadcast_change AFTER INSERT OR UPDATE OR DELETE ON public.%I '
                   'FOR EACH ROW EXECUTE FUNCTION public.broadcast_change()', _t);
  END LOOP;
END
$do$;

-- Who may listen to a private channel: org:<id> its members (and superusers),
-- user:<id> that person.
CREATE OR REPLACE FUNCTION public.may_hear_topic(_topic text)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := public.current_user_id();
BEGIN
  IF _uid IS NULL OR _topic IS NULL THEN
    RETURN false;
  END IF;
  IF _topic = 'user:' || _uid::text THEN
    RETURN true;
  END IF;
  IF _topic LIKE 'org:%' THEN
    RETURN public.is_member_of(_uid, substr(_topic, 5)::uuid) OR public.is_superuser(_uid);
  END IF;
  RETURN false;
EXCEPTION WHEN invalid_text_representation THEN
  RETURN false;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.may_hear_topic(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.may_hear_topic(text) TO authenticated;

-- The rule from before Clerk, for org-<id> topics nothing listens to. It
-- calls auth.uid(), which fails on a Clerk user id ("user_..." is not a
-- uuid); rules are combined with OR, so it would make every private channel
-- fail with it.
DROP POLICY IF EXISTS "Authenticated users can listen to their org channels" ON realtime.messages;
DROP POLICY IF EXISTS "Members hear their organisation's changes" ON realtime.messages;
CREATE POLICY "Members hear their organisation's changes" ON realtime.messages
  FOR SELECT TO authenticated
  USING (realtime.messages.extension = 'broadcast' AND public.may_hear_topic(realtime.topic()));

-- A copy fills a list in batches of 150 rows a table, and the app reloads
-- once it is done: no message per row for those. (A migration may not attach
-- agilefant.quiet to the function itself, "permission denied to set
-- parameter", so the function that does the filling is renamed and called
-- by one that is quiet while it runs. Callers find it by its old name.)
ALTER FUNCTION public.add_new_published_items(uuid, jsonb, integer) RENAME TO add_new_published_items_loudly;

CREATE OR REPLACE FUNCTION public.add_new_published_items(_copy_id uuid, _payload jsonb, _limit integer DEFAULT 150)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _was text := coalesce(current_setting('agilefant.quiet', true), '');
  _added integer;
BEGIN
  PERFORM set_config('agilefant.quiet', 'on', true);
  _added := public.add_new_published_items_loudly(_copy_id, _payload, _limit);
  PERFORM set_config('agilefant.quiet', _was, true);
  RETURN _added;
END;
$function$;
REVOKE EXECUTE ON FUNCTION public.add_new_published_items(uuid, jsonb, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.add_new_published_items(uuid, jsonb, integer) TO service_role;
