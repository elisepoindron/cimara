-- The freezing level at the time of the fetch, in metres, for the alpine
-- route's "Zero termico" card. Null on every row cached before this migration
-- and wherever the fetch gave none; the card is left out for those until the
-- next hourly refresh. Snowfall per day travels inside `days`, which is JSON.
alter table weather_cache add column freezing_level_m real;
