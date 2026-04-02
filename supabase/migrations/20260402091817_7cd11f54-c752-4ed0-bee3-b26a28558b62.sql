ALTER TABLE public.work_items
ADD COLUMN IF NOT EXISTS respawn_enabled boolean NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS respawn_interval_days integer,
ADD COLUMN IF NOT EXISTS respawn_hour integer,
ADD COLUMN IF NOT EXISTS respawn_last_triggered_at timestamptz;