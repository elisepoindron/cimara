-- The sport scale gained a plus step after each of 4a, 4b, 4c, 5a, 5b and 5c
-- (src/domain/quantity.ts). grade_min and grade_max are ordinals on that scale,
-- so every stored sport ordinal above 4a now names a different grade, and Find
-- would filter on the wrong one. This moves each to the position its grade
-- has now.
--
--   old:  3  4a  4b  4c  5a  5b  5c  6a ...
--         0  1   2   3   4   5   6   7  ...
--   new:  0  1   3   5   7   9   11  13 ...   (6a and above: old + 6)
--
-- Only falesia is graded on the sport scale; tests/db/sport-plus-steps.test.ts
-- holds the registry to that, so a second sport activity cannot be missed here.
-- A fresh database has no rows yet when this runs, and is seeded on the new scale.
update itinerary
   set grade_min = case when grade_min <= 1 then grade_min
                        when grade_min <= 6 then 2 * grade_min - 1
                        else grade_min + 6 end,
       grade_max = case when grade_max <= 1 then grade_max
                        when grade_max <= 6 then 2 * grade_max - 1
                        else grade_max + 6 end
 where activity = 'falesia'
   and grade_min is not null;
