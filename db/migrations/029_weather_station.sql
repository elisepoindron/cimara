-- Weather stations a route's page links to, so a climber can read what fell,
-- measured, where it is published. Nothing is read from them: a station is a
-- name, a height and a place, and its page is built from the network and the
-- network's own code for it (src/domain/stations.ts). Seeded from the list the
-- network publishes (src/seed/data/stazioni-meteo.json).

create table weather_station (
  network text not null,
  code    text not null,
  name    text not null,
  alt_m   integer not null,
  lat     real not null,
  lon     real not null,
  primary key (network, code)
) strict;

create index weather_station_position on weather_station (lat, lon);
