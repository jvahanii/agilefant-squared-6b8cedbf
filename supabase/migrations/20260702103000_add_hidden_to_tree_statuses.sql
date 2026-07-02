-- Add a `hidden` flag to tree_statuses so users can hide board columns per-tree.
-- Hidden columns are still present and their items are still tracked; they simply
-- don't appear in the board view until explicitly restored.

ALTER TABLE public.tree_statuses
  ADD COLUMN IF NOT EXISTS hidden BOOLEAN NOT NULL DEFAULT FALSE;
