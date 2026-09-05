-- Adds the 'm3u8' video provider: an HLS (.m3u8) playlist behind
-- Referer-based hotlink protection. source_ref (already on the table)
-- holds the playlist URL itself for this provider, same as it holds the
-- file URL for 'mp4'; this migration only adds the new column the
-- 'm3u8' provider additionally needs — the Referer value the source CDN
-- requires.
--
-- referer_header is NEVER sent to the client — only
-- app/api/video/[id]/hls-proxy/route.ts (service-role access, same as
-- the rest of this table) reads it, to attach the header server-side.
-- Browsers refuse to let client-side JS set a custom Referer header on
-- fetch()/XHR, so there is no way to honor this from hls.js directly;
-- see that route's comment for the full explanation.
--
-- Run this once against any existing project. Safe to run multiple times.

alter table public.videos
  add column if not exists referer_header text;
