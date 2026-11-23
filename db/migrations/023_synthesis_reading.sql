-- How a route's reports are read, and which ones have been.
--
-- The first readings asked the model for five themes over the whole route and
-- kept only those two reports shared, so half the reports on a busy crag were
-- in no theme at all. The reading that writes 2 goes through each report point
-- by point and keeps every theme, even one only one person has raised so far:
-- that report still shows it, and only themes two people share are counted on
-- the route page.
--
-- And it reads each report once. Reading the whole route again on every filing
-- moved the themes around each time — three readings of the same 32 reports
-- agreed on 3 of them — so a new report is read on its own and its points are
-- placed under the themes already there. `read_ids` is the reports a reading has
-- gone through, with or without a point in them; a standing report not in it is
-- still to be read. The whole route is read again only when `reading` is below
-- the one the code writes.
--
-- Every row already here was made by an earlier reading, so it defaults to 1
-- and the backfill reads those routes again once, whole.
alter table synthesis add column reading integer not null default 1;
alter table synthesis add column read_ids text not null default '[]'
  check (json_type(read_ids) = 'array');
