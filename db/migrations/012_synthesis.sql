-- Synthesizing what the relazioni say: a cached, grounded count per recurring
-- theme, regenerated whenever a gita is filed or withdrawn. A model classifies
-- which reports support each candidate theme; the count itself is computed in
-- code from that classification afterwards, and is never a number the model
-- stated itself. One row per itinerary — the latest synthesis replaces the last.

create table synthesis (
  itinerary_id  text not null references itinerary(id),
  generated_at  text not null,
  report_count  integer not null,
  themes        text not null check (json_type(themes) = 'array'),
  primary key (itinerary_id)
) strict;
