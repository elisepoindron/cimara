-- The multi-pitch rock-climbing activity was called arrampicata; its key in the
-- registry (src/domain/activities/multipitch.ts) is now multipitch. activity is
-- a plain text key with no table behind it, so the rows that carry the old key
-- move to the new one, or the startup check would refuse them. Its grades are
-- ordinals on the sport scale, which is unchanged, so nothing else moves.
update itinerary set activity = 'multipitch' where activity = 'arrampicata';
