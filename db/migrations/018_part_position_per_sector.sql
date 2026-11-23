-- A via's number is unique within its sector, not across the whole crag.
-- Topos number each sector from 1 ("Settore Take Away -- da sinistra: 1 ..."),
-- and 003's unique (itinerary_id, position) refused such a crag outright;
-- renumbering it would be inventing where a via sits.
--
-- Vie with no sector are one group of their own: coalesce makes a null sector
-- compare equal to itself, so two ungrouped vie numbered 3 are still refused,
-- as they were. (In a plain unique constraint two nulls are distinct.)
--
-- SQLite cannot drop a table constraint, so the table is rebuilt. Nothing
-- references part, and rows are copied in rowid order, so listParts' tie-break
-- (position, then rowid) still returns the source's order.
create table part_new (
  id           text primary key,
  itinerary_id text not null references itinerary(id) on delete cascade,
  group_name   text,            -- 'Basso', 'Scuola'; null when there are no sectors
  position     integer not null,
  fields       text not null default '{}' check (json_type(fields) = 'object')
) strict;

insert into part_new (id, itinerary_id, group_name, position, fields)
  select id, itinerary_id, group_name, position, fields from part order by rowid;

drop table part;
alter table part_new rename to part;

create unique index part_position_in_sector
  on part (itinerary_id, coalesce(group_name, ''), position);
create index part_itinerary_idx on part (itinerary_id, position);
