# Writing the public demo's content

The brief every writer of the demo's content is given (Phase 3 of
the demo's plan). It succeeds `scripts/demo/phase0-brief.md`,
which covered four activities; this one covers the seven the archive holds.

You are writing invented content for real places, for a public demo of an outdoor archive: an
Italian site where climbers, hikers, skiers and riders read about a place and the trip reports
(`relazioni`) people wrote about it. The places are real, read from OpenStreetMap. Everything you
write about them is invented and will be shown as invented. Write it well enough that a reader
believes several different people wrote it.

## Hard rules

- **Never name the site this app was designed from** (the checker knows the word and refuses
  it), nor any real website, guidebook, club or person. No real names of people at all: reports are unsigned.
- **Italian** for everything a reader sees (descriptions, route names, reports, theme names).
  Plain, natural Italian, as people write online: some write well, some write in a hurry.
- **No ratings.** No stars, no marks out of ten, no "voto", no condition scale ("ottime / buone /
  variabili / difficili / fuori condizione" as a verdict). People say in words how the day was.
- **Stay inside what the place is.** Use the measured facts you are given (height, the way the
  ground faces, comune, the OpenStreetMap tags). Do not contradict them. A crag at 1,500 m facing
  east is not climbed in the sun on a January afternoon. Do not invent named hamlets, roads,
  huts or bars you are not sure exist: say "dal paese", "dalla statale", "dal parcheggio". A
  place the tags name (`from`, `to`, `description`) or that is plainly famous (a hut, a pass, a
  town on the route) may be named.
- **Days** are between 2022-03-01 and 2026-11-15, in the season the place is actually done,
  more often on weekends and in good months — but **about a quarter on weekdays** (Monday to
  Friday), as on a real archive: holidays, days off, people who work shifts. A report written on
  a weekday never says "sabato" or "domenica". Never two reports with the same words.

## What you are given

Each place comes from `data/osm/places.json`:

```json
{ "osm": "n8062483777", "activity": "multipitch", "name": "Via Yoghi",
  "lat": 45.44104, "lon": 7.27094, "comune": "Ceresole Reale", "istat": "001073",
  "measured": { "quota_base": { "value": 1621, "from": "terrain" },
                "esposizione": { "value": "SE", "from": "terrain, 39° slope" },
                "tiri": { "value": 14, "from": "climbing:pitches" } },
  "hints": { "climbing:rock": "granite", "climbing:length": "450" },
  "needs": [], "track": false }
```

- `measured`: facts read from OpenStreetMap or the terrain. **Copy each into `facts` with the
  same value.** The one exception: an `esposizione` measured on a slope under 15° means nothing
  (the point is on flat ground); choose a plausible one and list `esposizione` in `invented`.
- `hints`: what the tags say. Use them (a grade range, a number of routes, a rock, a stage's ends,
  a distance), never against them.
- `needs`: what the page cannot be built without and only you can give (a crag's `vie`).
- `track: true`: the route's line is drawn from OpenStreetMap; do not describe a different line.

## What to write, per place

One JSON file per place, `src/seed/sets/demo/content/<osm>.json`, exactly this shape:

```json
{
  "osm": "w1096333248",
  "invented": ["avvicinamento", "vie", "description", "reports"],
  "itinerary": {
    "key": "corno-di-machaby",
    "activity": "falesia",
    "place": "comune-007004",
    "name": "Corno di Machaby",
    "lat": 45.64385, "lon": 7.75044,
    "aspect": "SO",
    "altMax": 1189,
    "facts": { },
    "sections": { },
    "parts": [ ],
    "reports": [ { "observedAt": "2025-10-12", "words": "…" } ]
  },
  "readings": [
    { "themes": [ { "label": "Avvicinamento breve", "quote": "…exact words from that report…" } ],
      "flags":  [ { "label": "Nuovi resinati in Placca Nord", "kind": "novita", "quote": "…exact sentence…" } ] }
  ]
}
```

- `osm`: the place's id, and the file's name. `key`: lowercase slug of the name. `place`:
  `comune-` + the place's `istat`. `name`, `lat`, `lon`: exactly as given.
- `aspect`, and `facts.esposizione` where the activity has it: one of `N NE E SE S SO O NO`
  (Italian: O is west). `altMax`: the highest point of the place where you know it (the crag's
  `quota_base`, a route's top); leave it out otherwise.
- `invented`: every fact, section and list you made up rather than took from what you were given:
  the fact ids (`avvicinamento`, `localita_partenza`…), `vie` or `tiri` for parts, `description`
  for the prose sections, `reports`.
- `readings` has exactly one entry per report, **in the same order as `reports`**.

### Facts, sections and parts by activity

What each activity holds is its registry file, `src/domain/activities/<activity>.ts`; the checker
reads it, so a fact or a section it does not declare is refused. Every fact is optional unless said.

**falesia** (a crag):
- `facts`: `esposizione` (required), `quota_base` (required, metres), `avvicinamento` (minutes on
  foot from the car, a number), optionally `localita_partenza` (only the comune's name or a place
  you are sure of), `come_arrivare`, `parcheggio_nota`. Never `vie` or `gradi` (counted from the
  routes) and never the ratings (`bellezza`, `chiodatura`, `tranquillita`, `comodita`,
  `voto_parcheggio`).
- `sections`: `note` (the description: rock, style, bolting, sun and shade, what to bring, 2–5
  short paragraphs), `avvicinamento` (the walk in, 1 paragraph), optionally `storia` (who bolted
  it is a person: say "i chiodatori locali", never a name).
- `parts`: the routes, each `{ "group": "<sector>", "fields": { "nome": "…", "grado": "6a+",
  "lunghezza": 25 } }`. **Grades are on the app's sport scale: `3`, then `4a` `4a+` `4b` … `9a`,
  with `+` on any letter. There is no `3a`, no `4`, no `4+`**: an easy route is `3`, `4a` or
  `4b`. Respect the tags when they give a min/max grade, lengths, or a number of routes (325
  routes need not all be written: write the star's sizes and say in `note` that there are more).
  Route names are invented, Italian or dialect or jokes, as real crags have; a few routes may
  have no name (leave `nome` out). Sizes: star 50–70 routes in 4–6 sectors, classic 25–40,
  regular 12–25, quiet and untouched 6–15.

**multipitch** (a route of several pitches, not a crag):
- `facts`: `grado_max` (the hardest pitch, sport scale), `grado_obbligatorio` (the hardest you
  cannot pull through on the bolts), `sviluppo` (metres of climbing), `tiri` (a number),
  `quota_base` (metres), `esposizione`, `avvicinamento` (minutes), `protezione` — one of
  `spittata` (bolted, no gear needed), `da_integrare` (bolted, bring some cams), `trad`;
  `localita_partenza`, `come_arrivare`. A tag's single `climbing:grade:french` is measured as
  `grado_max`; keep it and pick `grado_obbligatorio` at or below it.
- `sections`: `descrizione` (the line, its character, 2–4 paragraphs), `discesa` (how you get
  down: abseil the route, a path, 1 paragraph), `materiale` (rope, quickdraws, cams), optionally
  `note`, `avvicinamento` (the walk to the first pitch).
- `parts`: the pitches in order, **with no `group`**: `{ "fields": { "grado": "5c", "lunghezza":
  35, "descrizione": "Placca, poi una fessura a destra fino alla sosta." } }`, optionally
  `grado_fino` for a pitch between two grades. If `tiri` is given, write exactly that many
  pitches; their lengths add up to about `sviluppo`. No pitch harder than `grado_max`.

**bouldering** (a boulder or a boulder area), **mountain_bike**, **via_ferrata**:
- No facts: `facts` is `{}`. No `parts`: the problems of a boulder are told in words.
- `sections`: `descrizione` (2–5 paragraphs), optionally `note`, `avvicinamento`.
- bouldering: say what the boulder is (an erratic, a field of blocks), its rock, how high, the
  landings, which faces hold the problems and on what grades (Fontainebleau grades in words:
  "dal 5 al 7a"), the mats it needs.
- mountain_bike: the loop or the line, the climb (road, track, path), the descent's character,
  the surfaces, what is ridden and what is pushed, where water is, who else is on the trail.
- via_ferrata: the approach, the cable sections, the overhangs or bridges, the way down, the gear.

**escursionismo** (a hike), **sci_alpinismo** (a ski tour):
- `facts`: `difficolta` (escursionismo `T`, `E`, `EE`, `EEA`; sci_alpinismo `MS`, `BS`, `OS`, with
  `+`/`-` if you like), `partenza` (metres at the start), `vetta` (metres at the top),
  `dislivello` (metres of climb), `esposizione` — only where you can derive them honestly from the
  tags (`from`, `to`, `ascent`, `description`) or the place is famous enough to be sure;
  `localita_partenza`, `come_arrivare`. A measured `difficolta` (from `cai_scale`) is kept.
- `sections`: `descrizione` (the route: 2–5 paragraphs), optionally `note`.
- sci_alpinismo: the season is December to May, mostly February to April; snow, avalanche
  bulletin, ski crampons, the descent's line.
- No `parts`.

### Reports, by tier

| Tier | Reports | Length |
|---|---|---|
| star | 40–60 | from one line to a long paragraph; most 2–5 sentences |
| classic | 15–25 | 1–6 sentences |
| regular | 4–8 | 1–4 sentences |
| quiet | 1–3 | 1–2 sentences |
| untouched | none: `reports` and `readings` are `[]`, and **no `descrizione` or `note`** | |

An untouched page is built from what was measured: it gets no written description. A crag still
needs its routes (and may have its one-paragraph `avvicinamento`).

What people write about: the day (sun, wind, wet rock after rain, cold in the shade, heat, snow),
the approach, the rock and the bolting, which routes or pitches they did and how they felt,
crowds, dogs, kids, the parking, a hornet nest, a fallen tree, the view, a beer after. Mix it.
Not every report mentions every theme; most mention two or three things.

**Themes** recur across people: plan, before writing, 5–10 themes for a star (3–6 for a classic,
2–3 for a regular) that several reports will say in their own different words — e.g. the short
approach, polished classics, close bolting, the crag in the sun in winter, crowded at weekends,
the parking that fills up. Also give each star and classic 3–6 themes only one report raises.

**Lasting changes** (`flags`): things that changed for good, said by someone who noticed. A star
needs an arc over the years: e.g. a sector re-bolted (novita), a rockfall closes routes
(attenzione), then later reports mention it in passing; a path closed one spring, reopened in the
autumn. A classic gets 2–3 such changes, a regular 0–1. `kind` is `attenzione` (take care: a
loose flake, a missing bolt, a closed path) or `novita` (simply news: new routes, new bolts, a new
sign). Never the weather of that day; never how the place always was.

### Readings

For each report, the themes it carries and the changes it records, as a careful reader would
mark them:

- `label`: a short Italian name, 2–4 words, **the identical string every time the same theme
  comes up** in another report of the same place ("Avvicinamento breve", "Affollata nel
  weekend", "Chiodatura ravvicinata", "Sole d'inverno"). Neutral: a theme names what people say,
  not whether the place is good.
- `quote`: **copied character for character from that report's `words`** — the clause that says
  it, usually 3–12 words. Not paraphrased, not re-accented, same apostrophes. A quote that is not
  an exact substring is thrown away by the app.
- A report that says nothing recurring has `"themes": []`.

## Before you finish

Run the checker on your files and fix everything it reports, until it says `no problems`:

```
node --disable-warning=ExperimentalWarning scripts/demo/phase0-check.ts src/seed/sets/demo/content/<osm>.json …
```

It checks the shape, every fact and section against the activity's registry file, every value
against its scale, the measured facts against `data/osm/places.json`, the number of reports
against the place's tier (`src/seed/sets/demo/tiers/tiers.json`), the share of weekdays, and that
every quote is in its report's words.
