-- Remove the YouTube prototype.
--
-- It was a quick experiment for something since solved another way, and it was
-- carrying real weight: three tables with twelve RLS policies between them, an
-- edge function holding a shared API key, a superuser page, a hook, and a card
-- in Team Settings. None of it is used.
--
-- Nothing outside the feature referenced these tables -- their only foreign keys
-- pointed at organizations, and nothing pointed back -- so dropping them is
-- self-contained. Holding 15 channels, 8 search channels and 0 video links at
-- the time of removal.
--
-- The `youtube-proxy` edge function and the YOUTUBE_API_KEY secret are removed
-- separately; neither lives in the database.

DROP TABLE IF EXISTS public.youtube_video_links;
DROP TABLE IF EXISTS public.youtube_search_channels;
DROP TABLE IF EXISTS public.youtube_channels;
