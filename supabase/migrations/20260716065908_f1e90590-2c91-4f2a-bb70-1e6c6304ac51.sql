ALTER TABLE public.work_item_board_ranks
  ALTER COLUMN rank TYPE double precision USING rank::double precision;