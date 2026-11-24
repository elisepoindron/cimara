-- A route's elevation profile, read once from a terrain model along its
-- recorded track (migration 030). The ground does not change, so a kept
-- profile is never refetched; it is read again only when the track changes,
-- which track_key, a fingerprint of the track's points, says.
--
-- samples is JSON [[d, e, s, g], ...]: metres along, metres high, the ground's
-- angle in degrees, the path's gradient in per cent. null: the terrain was
-- asked and could not be read all along the line; asked again the next day.

create table profile_cache (
  itinerary_id text primary key references itinerary(id),
  track_key    text not null,
  samples      text,
  fetched_at   text not null
) strict;
