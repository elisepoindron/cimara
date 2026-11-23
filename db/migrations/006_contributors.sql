-- Project 2: the people who report, and what they file.

create table account (
  id            text primary key,
  email         text not null unique,
  password_hash text not null,
  display_name  text not null,          -- chosen once, never changed: every gita
                                        -- stays attached to its author
  created       text not null
) strict;

-- Fixed 30-day expiry, not extended on use. Simpler to reason about than a
-- sliding window, and nothing here needs anyone signed in indefinitely.
create table session (
  id         text primary key,          -- 32 random bytes, base64url; the cookie value
  account_id text not null references account(id),
  created    text not null,
  expires    text not null
) strict;
create index session_account_idx on session (account_id);

-- Failed sign-ins, counted per address rather than per IP: an IP is shared by
-- everyone behind one router, so throttling it locks out bystanders.
create table sign_in_failure (
  id       text primary key,
  email    text not null,
  failed_at text not null
) strict;
create index sign_in_failure_idx on sign_in_failure (email, failed_at desc);

-- The form: everything a person wrote.
create table gita (
  id           text primary key,
  itinerary_id text not null references itinerary(id),
  account_id   text not null references account(id),
  observed_at  text not null,           -- the day they went
  filed_at     text not null,           -- the day they wrote it up
  verdict      text not null check (verdict in
                 ('ottime','buone','variabili','difficili','fuori_condizione')),
  measures     text not null default '{}' check (json_type(measures) = 'object'),
  words        text not null
) strict;
create index gita_itinerary_idx on gita (itinerary_id, observed_at desc);
create index gita_account_idx on gita (account_id);

-- Withdrawing adds a row. It never deletes one, because conditions must stay
-- recomputable from zero and you cannot recompute from what was destroyed.
create table retraction (
  gita_id      text primary key references gita(id),
  retracted_at text not null
) strict;

-- Rebuild observation: SQLite cannot alter a CHECK, and measures still admits a
-- bare scalar where every other JSON column requires an object. Nothing
-- references observation, so dropping it breaks no other table's keys.
create table observation_new (
  id           text primary key,
  itinerary_id text not null references itinerary(id),
  observed_at  text not null,
  verdict      text not null check (verdict in
                 ('ottime','buone','variabili','difficili','fuori_condizione')),
  measures     text not null default '{}' check (json_type(measures) = 'object'),
  filed_at     text not null,
  gita_id      text references gita(id)   -- null for seeded and imported rows:
                                          -- nobody filled in those forms
) strict;

insert into observation_new (id, itinerary_id, observed_at, verdict, measures, filed_at)
  select id, itinerary_id, observed_at, verdict, measures, filed_at from observation;

drop table observation;                   -- takes its triggers and index with it
alter table observation_new rename to observation;

create index observation_itinerary_idx on observation (itinerary_id, observed_at desc);

create trigger observation_no_update before update on observation begin
  select raise(abort, 'observation is append-only: update is not permitted');
end;

create trigger observation_no_delete before delete on observation begin
  select raise(abort, 'observation is append-only: delete is not permitted');
end;
