CREATE OR REPLACE FUNCTION public.seed_default_tree_statuses()
 RETURNS trigger
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
BEGIN
  INSERT INTO public.tree_statuses (tree_id, key, label, color, rank) VALUES
    (NEW.id, 'not_started', 'Not Started', '#94a3b8', 0),
    (NEW.id, 'in_progress', 'In Progress', '#f97316', 1),
    (NEW.id, 'pending',     'Pending',     '#f59e0b', 2),
    (NEW.id, 'blocked',     'Blocked',     '#ef4444', 3),
    (NEW.id, 'done',        'Done',        '#22c55e', 4)
  ON CONFLICT (tree_id, key) DO NOTHING;
  RETURN NEW;
END; $function$;