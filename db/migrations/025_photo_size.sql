-- A photo's width and height as it is shown, read from its bytes when it is
-- written (src/domain/image-size.ts). The photos page lays every photo out at
-- its own shape before any has loaded (photos-page-options.html, B).
--
-- Null for a photo written before this, and for bytes whose size could not be
-- read: the page then draws a plain frame. The seed fills in its own photos'
-- sizes on its next run.
alter table gita_photo add column width integer check (width > 0);
alter table gita_photo add column height integer check (height > 0);
alter table imported_report_photo add column width integer check (width > 0);
alter table imported_report_photo add column height integer check (height > 0);
