-- activity is a plain text key into the code-resident registry; there is no
-- activity table. The startup check is what keeps the two in step.
-- One representative point, not a line: the only spatial question asked is how
-- far apart two things are.
create table itinerary (
  id       text primary key,
  activity text not null,
  place_id text not null references place(id),
  name     text not null,
  lat      real,
  lon      real,
  aspect   text check (aspect is null or aspect in
             ('N','NE','E','SE','S','SO','O','NO')),
  alt_max  integer,
  facts    text not null default '{}' check (json_type(facts) = 'object'),
  sections text not null default '{}' check (json_type(sections) = 'object'),
  created  text not null                      -- ISO-8601 UTC; sorts as text
) strict;

create index itinerary_bbox_idx     on itinerary (lat, lon);
create index itinerary_activity_idx on itinerary (activity);
create index itinerary_aspect_idx   on itinerary (aspect, alt_max);
