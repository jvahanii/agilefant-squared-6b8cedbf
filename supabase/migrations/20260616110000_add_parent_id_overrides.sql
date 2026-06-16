-- Add per-tree parent overrides to work_items.
-- This column stores a JSON object mapping treeId -> parentId (or null),
-- allowing a work item to appear under a different parent in each backlog
-- tree without changing the global parent_id.
ALTER TABLE work_items
  ADD COLUMN IF NOT EXISTS parent_id_overrides JSONB NOT NULL DEFAULT '{}';
