-- Weather is now asked for at the route's altitude (a crag's base, otherwise
-- its start), so the altitude joins the key: two routes within a kilometre can
-- be a thousand metres apart, and must not share a row. alt_m is -1 where no
-- altitude was asked for and Open-Meteo used the ground's under the
-- coordinates, which is what every row cached before this migration is; they
-- are kept under that key. A key column cannot be null and still be one row.

create table weather_cache_by_altitude (
  lat_r            real not null,
  lon_r            real not null,
  alt_m            integer not null,
  fetched_at       text not null,
  temp_c           real not null,
  days_since_rain  integer,
  days             text,
  freezing_level_m real,
  primary key (lat_r, lon_r, alt_m)
) strict;

insert into weather_cache_by_altitude
  (lat_r, lon_r, alt_m, fetched_at, temp_c, days_since_rain, days, freezing_level_m)
select lat_r, lon_r, -1, fetched_at, temp_c, days_since_rain, days, freezing_level_m
from weather_cache;

drop table weather_cache;
alter table weather_cache_by_altitude rename to weather_cache;
