-- A `near` constraint names the place you travel FROM, and that is usually a
-- city with no routes in it. Deriving a place's position from the itineraries
-- under it works for a valley and fails for exactly the case the design puts on
-- screen: "entro 40 km da Torino" is a question asked from a place where nobody
-- climbs.
--
-- So a place may carry its own position. Nullable, because most do not need one
-- -- a valley is still better described by the routes in it than by a point
-- somebody chose -- and the derived centre remains the fallback.
--
-- The second and last column promotion of project 4. The spec said grade would
-- be the only one; that was written before anything tried to answer the design's
-- own example line.
alter table place add column lat real;
alter table place add column lon real;
