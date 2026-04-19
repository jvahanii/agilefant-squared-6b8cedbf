-- Per-user snooze state for work items
CREATE TABLE public.work_item_snoozes (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  user_id uuid NOT NULL,
  work_item_id text NOT NULL,
  organization_id uuid NOT NULL,
  snoozed_until timestamptz NOT NULL,
  note text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, work_item_id)
);

CREATE INDEX idx_work_item_snoozes_user ON public.work_item_snoozes(user_id);
CREATE INDEX idx_work_item_snoozes_work_item ON public.work_item_snoozes(work_item_id);
CREATE INDEX idx_work_item_snoozes_until ON public.work_item_snoozes(snoozed_until);

ALTER TABLE public.work_item_snoozes ENABLE ROW LEVEL SECURITY;

-- Users only see/manage their own snoozes (superuser bypass)
CREATE POLICY "Users can read own snoozes"
ON public.work_item_snoozes
FOR SELECT
TO authenticated
USING (user_id = auth.uid() OR is_superuser(auth.uid()));

CREATE POLICY "Users can insert own snoozes"
ON public.work_item_snoozes
FOR INSERT
TO authenticated
WITH CHECK (
  user_id = auth.uid()
  AND (
    is_member_of(auth.uid(), organization_id)
    OR is_work_item_accessible(auth.uid(), work_item_id)
  )
);

CREATE POLICY "Users can update own snoozes"
ON public.work_item_snoozes
FOR UPDATE
TO authenticated
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid());

CREATE POLICY "Users can delete own snoozes"
ON public.work_item_snoozes
FOR DELETE
TO authenticated
USING (user_id = auth.uid() OR is_superuser(auth.uid()));

-- Auto-update updated_at
CREATE OR REPLACE FUNCTION public.touch_work_item_snoozes_updated_at()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN NEW.updated_at = now(); RETURN NEW; END;
$$;

CREATE TRIGGER trg_touch_work_item_snoozes_updated_at
BEFORE UPDATE ON public.work_item_snoozes
FOR EACH ROW
EXECUTE FUNCTION public.touch_work_item_snoozes_updated_at();

-- Realtime
ALTER PUBLICATION supabase_realtime ADD TABLE public.work_item_snoozes;
ALTER TABLE public.work_item_snoozes REPLICA IDENTITY FULL;