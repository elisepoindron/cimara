# Cimara

Cimara is a demonstration of a mountain archive: crags, multi-pitch routes, boulders, via
ferratas, hikes, ski tours and bike rides in the western Alps of Italy, each with its
description, its facts and the reports of the people who went there. The places are real,
taken from OpenStreetMap; the descriptions, the crags' routes and every report are invented
for the demo, and say nothing about the real conditions of any place. The interface is in
Italian, because the archive is written for Italian climbers.

**Live demo:** _(link to come)_

## The idea

Collaborative outdoor archives hold something no guidebook has: hundreds of trip reports per
route, written by the people who were there. On most of them that wealth is buried. A route
page shows the reports as a list of free text, ten tabs away from each other, and the one tab
that promises *conditions* holds a single entry somebody once filled in.

Cimara rebuilds the page around one distinction: **what lasts and what passes.**

- **What lasts** is the route itself: the approach, the rock, the grade, the way down. It is
  written once, corrected now and then, and it is the page's description.
- **What passes** is how a day was. That lives in the reports, and the page reads them for
  you: `Cosa dicono le relazioni` gathers the themes several people raised, in their own
  words, and the lasting changes someone flagged (a bolt replaced, a flake gone), each linked
  back to the reports it came from.

Two surfaces instead of eleven tabs: the page of a place, and **Find**, one editable sentence
over the whole archive (`falesie vicino a Ivrea, dal 5c al 6b`) whose every word is a slot
you can change, beside a map that is always there.

And one rule above the rest: **nothing grades a route's conditions.** There is no score, no
traffic light, no "good today". What the page says about today is the sky — the last rain,
the freezing level, the fresh snow, the wind, from a weather model at the route's own height —
and what it says about the reports is how many there are and when the last one was written.
A climber reads the rest better than any formula.

## The stars

Ten places carry the most content, one or more per activity. Start with them:

- [Corno di Machaby](#) — falesia, Arnad
- [Palestra di roccia di Traversella](#) — falesia, Traversella
- [El Coup de Roure](#) — falesia, Sampeyre
- [Via Yoghi](#) — multipitch, Ceresole Reale
- [Pietra Alta](#) — bouldering, Caselette
- [Via Ferrata Carlo Giorda](#) — via ferrata, Sant'Ambrogio di Torino
- [Rifugio Deffeyes – Tête du Rutor](#) — sci alpinismo, La Thuile
- [Alta Via n. 2 della Valle d'Aosta – Tappa 10](#) — escursionismo, Cogne
- [Via Francigena – 01 Valle d'Aosta](#) — escursionismo, Saint-Oyen
- [Jafferau](#) — mountain bike, Bardonecchia

## How it is built

A server-rendered Node app over SQLite, with no build step and one runtime dependency.

- **Node 24 runs the TypeScript directly.** `tsconfig.json` exists for `tsc --noEmit` and
  nothing else; there is no bundler and no framework.
- **One runtime dependency**, `@anthropic-ai/sdk`, used for three things only: reading a
  route's reports into shared themes, rereading a Find line that found nothing, and sorting
  an import's prose. Every one is optional: without `ANTHROPIC_API_KEY` the app says so once
  and works without it. The demo's themes are recorded readings, so it needs no key at all.
- **Pages are HTML from the server**, built through a branded `Html` type: a value is only
  made with `html`, `raw`, `join` and `concat`, so "did I escape this?" is a question the type
  checker answers. The browser adds the map (MapLibre, self-hosted) and small enhancements.
- **Nineteen activities, one template.** A registry (`src/domain/activities/`) declares each
  activity's header facts, its two page columns, its parts and how long a report counts as
  recent. Adding an activity that is only prose is one file and no migration.
- **Pure decisions, SQL for sets.** `src/domain/` imports nothing from the database, the
  renderer or Node; SQL lives only in `src/db/`, behind functions that speak the domain. The
  nearby-places query is the worked example: SQL narrows to a bounding box on indexed
  coordinates, then a pure haversine decides the true radius.
- **Reports are append-only.** Withdrawing a report inserts a retraction; nothing is deleted.
- **Imports refuse, never guess.** The OpenStreetMap importer (`src/import/osm/`) refuses a
  row it cannot read, by name, with the field and what it found, rather than inventing a value
  to make it fit.
- **Find parses against the archive, not a word list.** A word is a constraint because a place
  or an activity by that name exists; what the parser cannot read stays visible under the
  sentence instead of being silently dropped.

The weather is fetched server-side from Open-Meteo and cached; walking paths come from BRouter;
the map's tiles from OpenFreeMap, Mapterhorn and OpenTopoMap. All are free and keyless.

## Running it

Node 24 or later.

```bash
npm install
DATABASE_FILE=build/demo.db npm run demo:build   # builds the demo's database from the repository
DATABASE_FILE=build/demo.db npm start            # then http://localhost:3000
```

`demo:build` reads only what the repository holds (the OpenStreetMap extract in
`data/osm/extract/`, the written content in `src/seed/sets/demo/content/` and the recorded
readings) and calls no network. `Dockerfile.demo` runs the same build at image time.

## Tests

```bash
npm test           # node --test, nothing to start first
npm run typecheck  # tsc --noEmit
```

Every database test builds its own SQLite database in memory. The suite includes the public
deploy itself: it builds the demo, serves it, visits every page a visitor can reach and checks
what comes back.

## Layout

```
src/domain/    pure: no database, no rendering, no node:*
src/db/        the only place SQL is allowed
src/render/    Html values, never raw strings
src/app/       orchestration and the HTTP server
src/import/    foreign archives and OpenStreetMap, read and refused
src/demo/      the demo's database build
src/seed/      the seed data sets and the shared gazetteer
db/migrations/ numbered .sql files, applied once, in order
public/        the stylesheet, the browser scripts, the self-hosted map library
tests/         one file per module
```

## Licence

All rights reserved: the code is here to be read, not reused (see `LICENSE`). The
third-party data and the map library keep their own licences, listed there.

## Credits

Places © OpenStreetMap contributors (ODbL). Weather by Open-Meteo. Map tiles by OpenFreeMap,
Mapterhorn and OpenTopoMap. Routing by BRouter.
