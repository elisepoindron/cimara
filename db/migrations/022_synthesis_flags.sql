-- What the reading flagged: for a report that says something on the crag or the
-- route changed for good (a flake gone, routes added, bolts replaced), the one
-- sentence of its own words that says so. Written beside the themes by the same
-- regeneration, and grounded the same way: a sentence that is not an exact
-- substring of the report's words never reaches this column.
--
-- Each theme in `themes` now also keeps the ids of the reports it was counted
-- from, so the reports page can say which themes a report was counted in. Rows
-- written before this migration have none, and say nothing until regenerated.
alter table synthesis add column flags text not null default '[]'
  check (json_type(flags) = 'array');
