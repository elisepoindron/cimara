-- Photos on a report brought in from another archive.
--
-- Not gita_photo: that table's rows hang off a gita, and a gita is something
-- somebody filed here and can withdraw. An imported report is neither, so its
-- photos get a table of their own, read beside gita_photo by photosFor.
--
-- A photo that came with an imported report was taken by somebody this
-- archive has no account for, and is shown under a licence. Both are kept,
-- with where the photo came from, because the licence asks for all three on
-- screen: who took it, under what terms, and where to find the original. None
-- is ever guessed; a photo without them is refused before it gets here.
create table imported_report_photo (
  id                 text primary key,
  imported_report_id text not null references imported_report(id),
  position           integer not null check (position between 0 and 5),
  caption            text check (caption <> ''),   -- null when there is none
  mime               text not null check (mime in ('image/jpeg','image/png')),
  author             text not null check (author <> ''),
  licence            text not null check (licence <> ''),
  licence_url        text check (licence_url <> ''),
  source             text not null check (source <> '')
) strict;

create unique index imported_report_photo_report_idx
  on imported_report_photo (imported_report_id, position);
