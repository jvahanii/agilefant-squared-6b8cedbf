-- Add visible column to tree_statuses to support hiding columns in board view
ALTER TABLE tree_statuses
ADD COLUMN IF NOT EXISTS visible boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN tree_statuses.visible IS 'Whether this status column is visible in the board view';