-- The ten days the Condizioni weather strip draws: seven past, today, two
-- forecast, as JSON. Null on every row cached before this migration, and on
-- any row whose fetch gave no usable days; the strip is left out for those
-- until the next hourly refresh, and the rules, which read only temp_c and
-- days_since_rain, carry on as before.

alter table weather_cache add column days text;
