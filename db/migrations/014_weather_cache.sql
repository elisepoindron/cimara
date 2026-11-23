-- Weather, server-fetched and cached per rounded coordinate (~1.1 km, so every
-- route at one crag shares a row). Read by both the condition engine's
-- adjustment rules and the route/crag Meteo module — one fetch path, not two.
-- Refreshed lazily on read, when stale; never fetched inline for a request
-- that only needs the last known value (src/app/weather.ts).

create table weather_cache (
  lat_r           real not null,
  lon_r           real not null,
  fetched_at      text not null,
  temp_c          real not null,
  days_since_rain integer,
  primary key (lat_r, lon_r)
) strict;
