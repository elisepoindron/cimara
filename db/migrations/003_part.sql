-- An optional subdivision. What a part is, is declared by the activity.
-- Nothing is ever reported on a part: no conditions, no observations, no page.
create table part (
  id           text primary key,
  itinerary_id text not null references itinerary(id) on delete cascade,
  group_name   text,            -- 'Basso', 'Scuola'; null when there are no sectors
  position     integer not null,
  fields       text not null default '{}' check (json_type(fields) = 'object'),
  unique (itinerary_id, position)
) strict;
create index part_itinerary_idx on part (itinerary_id, position);
