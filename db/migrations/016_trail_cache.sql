-- The walking path from a parking spot to a crag, as a hiking router found it,
-- server-fetched and cached per pair of points (rounded to five decimals,
-- about a metre). Crags that share a parking spot still get a row each: the
-- walk is to the wall, not to the car park.
--
-- coords is the path as JSON [[lon, lat], ...]. Null records an answer that
-- was no use (no path, or one that stops short of the wall), so the router is
-- not asked again on every page view; src/app/trail.ts retries those sooner
-- than it refreshes a path it kept.

create table trail_cache (
  from_lat    real not null,
  from_lon    real not null,
  to_lat      real not null,
  to_lon      real not null,
  fetched_at  text not null,
  coords      text,
  length_m    integer,
  ascent_m    integer,
  primary key (from_lat, from_lon, to_lat, to_lon)
) strict;
