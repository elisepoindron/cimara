-- A route's own track: the way as somebody walked it with a GPS, as the source archive
-- offers it for download on a hike. One per route. Not the trail_cache of
-- migration 016, which is a router's guess between two points and refetched;
-- this is a recording, kept as it was read.
--
-- coords is the track as JSON [[lon, lat, ele], ...], ele null where the file
-- gave none. source says where it came from, for whoever has to answer for it.

create table itinerary_track (
  itinerary_id text primary key references itinerary(id),
  coords       text not null,
  source       text not null
) strict;
