-- A reading is modelled data. Where it came from is not this system's concern;
-- when it was taken is. Integrating live camera feeds is out of scope.
create table webcam (
  id   text primary key,
  name text not null,
  lat  real not null,
  lon  real not null
) strict;
create index webcam_bbox_idx on webcam (lat, lon);

create table webcam_reading (
  id           text primary key,
  webcam_id    text not null references webcam(id) on delete cascade,
  taken_at     text not null,
  snow_above_m integer
) strict;
create index webcam_reading_idx on webcam_reading (webcam_id, taken_at desc);
