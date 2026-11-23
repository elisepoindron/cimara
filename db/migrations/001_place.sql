-- Administrative hierarchy for the breadcrumb, plus named areas that cross it.
create table place (
  id        text primary key,
  name      text not null,
  kind      text not null check (kind in
              ('regione','provincia','comune','area','montagna','valle')),
  parent_id text references place(id),
  check (parent_id is null or parent_id <> id)
) strict;
create index place_parent_idx on place (parent_id);

-- Valle dell'Orco holds crags in two provinces; this is how.
create table place_area (
  place_id text not null references place(id) on delete cascade,
  area_id  text not null references place(id) on delete cascade,
  primary key (place_id, area_id)
) strict;
