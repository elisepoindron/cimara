-- Photos uploaded before the gita that will claim them exists: promoted into
-- gita_photo when one is filed, or swept once expired.

create table pending_photo (
  id         text primary key,
  account_id text not null references account(id),
  mime       text not null check (mime in ('image/jpeg','image/png')),
  created    text not null,
  expires    text not null
) strict;
create index pending_photo_expires_idx on pending_photo (expires);
