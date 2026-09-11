-- Broadcast changes to published_links, so the sidebar's "published" markers
-- update live when anyone publishes or unpublishes.
--
-- The client does not read the events' contents: any change just triggers a
-- reload of which targets are published. That matters because, on a table with
-- RLS, a DELETE event carries only the primary key -- here the token -- so it
-- could not say which marker to remove anyway. It also means the token of a
-- link being unpublished reaches subscribers in that event; by then the row is
-- gone and the token is dead, so it opens nothing. INSERT events are filtered
-- by RLS as usual: nobody hears about links on trees they cannot see.

ALTER PUBLICATION supabase_realtime ADD TABLE public.published_links;
