-- Remember what a job posting said last time it was asked.
--
-- Checking a backlog means fetching every posting in it, and a job board reads
-- dozens of requests from one datacentre address as a scraper: LinkedIn answers
-- 999 and the check learns nothing. Pressing the button again repeats the same
-- burst and meets the same wall.
--
-- Most of that traffic is asking a question already answered. A posting that
-- has closed never reopens, so the answer keeps forever; one still open is
-- worth re-asking, but daily rather than on every press. Remembering both turns
-- the second sweep over a backlog into a handful of requests, which is the only
-- approach to the refusals that does not involve deceiving the board about who
-- is calling.
--
-- Keyed by a hash of the fetch target rather than the URL itself: a job link
-- can carry hundreds of characters of tracking parameters, and a btree index
-- refuses a key past about 2.7 KB. The target is kept alongside for reading.

CREATE TABLE IF NOT EXISTS public.posting_checks (
  target_hash text PRIMARY KEY,
  target      text        NOT NULL,
  closed      boolean     NOT NULL,
  -- The closing date the posting stated, where it stated one.
  deadline    date,
  checked_at  timestamptz NOT NULL DEFAULT now()
);

-- Only the edge function reaches this, through the service role, which RLS does
-- not apply to. Enabled with no policies at all, so every other role — every
-- signed-in user included — sees nothing. There is nothing private in a public
-- job ad, but nothing here is any client's business either, and a table with
-- RLS off would be readable by all of them.
ALTER TABLE public.posting_checks ENABLE ROW LEVEL SECURITY;

-- For trimming entries nobody has looked at in a long while.
CREATE INDEX IF NOT EXISTS posting_checks_checked_at_idx
  ON public.posting_checks (checked_at);

COMMENT ON TABLE public.posting_checks IS
  'Cached job-posting verdicts for the closed-ad check. Written only by the posting-status edge function; closed entries never expire, open ones are re-fetched after a day.';
