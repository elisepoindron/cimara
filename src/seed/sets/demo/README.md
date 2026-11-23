# The demo set

The public demo's archive: real OpenStreetMap places, with content written for the demo and
said to be invented (the demo's plan, Phases 2–6). It is
not seeded: `DATABASE_FILE=build/demo.db npm run demo:build` builds the whole database ahead of
time (`src/demo/build.ts`), and `Dockerfile.demo` runs that build when the image is made.
`SEED_SET=demo` is still how the server picks this set's brand (`brand/`).

Its subfolders, which the seed never reads as routes:

- `content/` — the written content, one file per place (`<osm>.json`), checked by
  `scripts/demo/phase0-check.ts` and built into the archive by `npm run demo:build` (below);
- `tiers/tiers.json` — which places the archive holds and in which tier, chosen by
  `scripts/demo/phase3-tiers.ts` (re-run it, never edit by hand). `npm run demo:build` builds
  these places, plus every place with content;
- `brief.md` — what every writer of `content/` is given;
- `brand/` — the demo's name and mark.

A file here may name any comune of the gazetteer by its key (`comune-001044`, Bussoleno) without declaring
it: the seed reads every file's places before any file's itineraries.

## Content

`content/<osm>.json`, one file per place, named for the OpenStreetMap id of a place in
`data/osm/places.json` (shape: `scripts/demo/phase0-content/*.json`, checked by
`scripts/demo/phase0-check.ts`):

- `osm` — the place's id; `invented` — what was made up (`vie`, `reports`, a fact's id…);
- `itinerary` — the seed's shape: `key` (a slug, unique), `sections`, `facts`, `parts` (a crag's
  vie), `reports` (`observedAt`, `words`, optional `photos` from `photos/` beside this folder,
  credited in its `credits.json`);
- `readings` — one per report, in order: the themes and changes its writer planted, each with
  the exact words that say it.

The place itself comes from OpenStreetMap: its activity, name, comune (`place`), position and
every measured fact. A content file may repeat them and must then agree; one that contradicts
them, names no place, or names a place the importer refuses stops the build, naming the file
and the field. A fact the place still `needs` (a crag's `vie`, a flat crag's `esposizione`) must
be written and listed in `invented`; a place whose needs no file supplies is left out of the
build and counted in its report, never filled in.
