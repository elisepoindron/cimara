-- Where to park is not where the route is: Monviso's stored lat/lon is its
-- summit, and Balma Scura's is the crag itself, neither of which is the
-- trailhead a visitor actually drives to. A second point, nullable like the
-- itinerary's own lat/lon, because most rows will not have one recorded yet.
alter table itinerary add column parking_lat real;
alter table itinerary add column parking_lon real;
