-- What the conditions engine reads. One gita produces exactly one observation;
-- the engine never reads prose. Project 2 writes these from gite; project 1
-- seeds them directly.
--
-- Note there is no "on delete cascade" from itinerary: the append-only trigger
-- below would block the cascade and turn it into a foreign-key error.
create table observation (
  id           text primary key,
  itinerary_id text not null references itinerary(id),
  observed_at  text not null,        -- the day they went, not the day they filed
  verdict      text not null check (verdict in
                 ('ottime','buone','variabili','difficili','fuori_condizione')),
  measures     text not null default '{}' check (json_valid(measures)),
  filed_at     text not null
) strict;
create index observation_itinerary_idx on observation (itinerary_id, observed_at desc);

-- Append-only. This is what makes condition state recomputable from zero after a
-- decay rule changes, and it is why no separate conditions service is needed.
create trigger observation_no_update before update on observation begin
  select raise(abort, 'observation is append-only: update is not permitted');
end;

create trigger observation_no_delete before delete on observation begin
  select raise(abort, 'observation is append-only: delete is not permitted');
end;
