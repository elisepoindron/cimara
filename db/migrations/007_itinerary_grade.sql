-- Find narrows on grade, so grade becomes a column. Stored as an ordinal on the
-- activity's own scale rather than as text: a text comparison sorts "10a" below
-- "4a", which is the wrong answer to the only question this column exists for.
--
-- Ordinals are comparable only inside one scale. AD is 6 on the alpine scale and
-- 6a is 7 on the sport scale, and neither says anything about the other. That is
-- safe because a grade constraint always carries an activity with it -- a grade
-- names its own scale -- and the activity constraint is hard.
--
-- Nullable, because a route may declare no grade at all, and absent is not zero.
alter table itinerary add column grade_min integer;
alter table itinerary add column grade_max integer;

create index itinerary_grade_idx on itinerary (activity, grade_min, grade_max);
