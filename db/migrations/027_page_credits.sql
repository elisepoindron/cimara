-- A page's own credits, as the source archive closes every route: when its
-- description was last revised and who wrote it (route-footer-options.html, B).
--
-- revised is a bare UTC day, null where nothing records one: an importer never
-- invents it. The authors are accounts, in the order the page names them, so a
-- name on a page is somebody, not a string. Nothing here is about reports:
-- the authors wrote the description, and a report stays its own day and words.
alter table itinerary add column revised text
  check (revised is null or revised glob '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]');

create table itinerary_author (
  itinerary_id text not null references itinerary(id),
  account_id   text not null references account(id),
  position     integer not null check (position >= 0),
  primary key (itinerary_id, account_id),
  unique (itinerary_id, position)
);
