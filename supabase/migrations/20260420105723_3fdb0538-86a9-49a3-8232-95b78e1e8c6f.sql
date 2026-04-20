-- Update seed function to use teal for pending
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
    (NEW.id, 'pending',     'Pending',     '#14b8a6', 2),
    (NEW.id, 'blocked',     'Blocked',     '#ef4444', 3),
    (NEW.id, 'done',        'Done',        '#22c55e', 4)
  ON CONFLICT (tree_id, key) DO NOTHING;
  RETURN NEW;
END; $function$;

-- Update all existing pending status rows from orange to teal
UPDATE public.tree_statuses
SET color = '#14b8a6'
WHERE key = 'pending' AND color = '#f59e0b';