-- Photos on a gita: filed alongside it, hidden with it when it is retracted.

create table gita_photo (
  id       text primary key,
  gita_id  text not null references gita(id),
  position integer not null check (position between 0 and 5),
  caption  text,                        -- null, never '', when none was typed
  mime     text not null check (mime in ('image/jpeg','image/png'))
) strict;

-- Fast lookup ordered by position, and the same belt-and-suspenders this
-- schema already applies to verdict and mime: a bug cannot silently double up
-- a slot rather than refusing to write.
create unique index gita_photo_gita_idx on gita_photo (gita_id, position);
