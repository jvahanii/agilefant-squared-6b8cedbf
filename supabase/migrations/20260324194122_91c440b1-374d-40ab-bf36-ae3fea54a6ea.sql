
-- Create backlog_trees table
CREATE TABLE public.backlog_trees (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  rank INTEGER NOT NULL DEFAULT 0
);

-- Create backlogs table
CREATE TABLE public.backlogs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  parent_id TEXT REFERENCES public.backlogs(id) ON DELETE CASCADE,
  tree_id TEXT NOT NULL REFERENCES public.backlog_trees(id) ON DELETE CASCADE,
  rank INTEGER NOT NULL DEFAULT 0
);

-- Create work_items table
CREATE TABLE public.work_items (
  id TEXT PRIMARY KEY,
  title TEXT NOT NULL,
  description TEXT,
  points INTEGER,
  parent_id TEXT REFERENCES public.work_items(id) ON DELETE CASCADE,
  backlog_assignments JSONB NOT NULL DEFAULT '{}',
  rank INTEGER NOT NULL DEFAULT 0
);

-- Public RLS policies (no auth required)
ALTER TABLE public.backlog_trees ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.backlogs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.work_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Public read access" ON public.backlog_trees FOR SELECT USING (true);
CREATE POLICY "Public insert access" ON public.backlog_trees FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access" ON public.backlog_trees FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete access" ON public.backlog_trees FOR DELETE USING (true);

CREATE POLICY "Public read access" ON public.backlogs FOR SELECT USING (true);
CREATE POLICY "Public insert access" ON public.backlogs FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access" ON public.backlogs FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete access" ON public.backlogs FOR DELETE USING (true);

CREATE POLICY "Public read access" ON public.work_items FOR SELECT USING (true);
CREATE POLICY "Public insert access" ON public.work_items FOR INSERT WITH CHECK (true);
CREATE POLICY "Public update access" ON public.work_items FOR UPDATE USING (true) WITH CHECK (true);
CREATE POLICY "Public delete access" ON public.work_items FOR DELETE USING (true);
