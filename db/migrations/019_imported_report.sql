-- A report brought in from another archive, kept for its words.
--
-- Not a gita: nobody filed it here, so it has no account, cannot be withdrawn
-- and carries no photos -- the three things the gita table's references are
-- for. Many such reports say nothing about conditions (the bolting, the
-- grades, the road), so its verdict may be null. Where it has one, the
-- importer also writes an observation, exactly as it did before this table
-- existed; the engine reads observations, never this table, so keeping the
-- words moves no condition.
--
-- giteFor reads this table beside gita, so the reports page and the synthesis
-- see imported words as they see filed ones.
create table imported_report (
  id           text primary key,
  itinerary_id text not null references itinerary(id),
  observed_at  text not null,                  -- the day they went, as the source says
  verdict      text check (verdict in
                 ('ottime','buone','variabili','difficili','fuori_condizione')),
  words        text not null check (words <> '')
) strict;

create index imported_report_itinerary_idx on imported_report (itinerary_id, observed_at desc);
