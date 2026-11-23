-- Project 5: marking a route or crag to find again, without searching for it.
--
-- Unlike gita/observation, a favorite carries no evidence the conditions engine
-- reasons over, so it does not take the append-only shape those tables do —
-- unfavoriting deletes the row outright.

create table favorite (
  account_id   text not null references account(id),
  itinerary_id text not null references itinerary(id),
  created      text not null,
  primary key (account_id, itinerary_id)
) strict;

-- The list page reads most-recently-favorited first.
create index favorite_account_idx on favorite (account_id, created desc);
