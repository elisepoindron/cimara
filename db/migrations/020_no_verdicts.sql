-- Conditions without verdicts: a report is a date, words and photos.
-- See its design spec.
--
-- The verdict and the measures go, and with them the table that existed only to
-- hold them for the grading engine. On 16 November 2026 the local archive held
-- 53 verdicts, every one from the seed or an import and none filed by a visitor.
--
-- observation refused deletes by trigger, on purpose, so its rows are not
-- deleted: the triggers and the table are dropped whole. A report stays
-- append-only where it always was: withdrawing a gita adds a retraction.
drop trigger if exists observation_no_update;
drop trigger if exists observation_no_delete;
drop table observation;

-- Each column's CHECK is its own, so SQLite drops the column with it.
alter table gita drop column verdict;
alter table gita drop column measures;
alter table imported_report drop column verdict;
