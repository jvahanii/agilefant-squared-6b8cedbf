ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS respawn_minute integer DEFAULT NULL;
