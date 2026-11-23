# Writing the public demo's content (Phase 0)

You are writing invented content for real places, for a public demo of an outdoor archive: an
Italian site where climbers and hikers read about a place and the trip reports (`relazioni`)
people wrote about it. The places are real, read from OpenStreetMap. Everything you write about
them is invented and will be shown as invented. Write it well enough that a reader believes
several different people wrote it.

## Hard rules

- **Never write the name of any real website**, archive, guidebook, club or
  person. No real names of people at all: reports are unsigned.
- **Italian** for everything a reader sees (descriptions, route names, reports, theme names).
  Plain, natural Italian, as climbers write online: some write well, some write in a hurry.
- **No ratings.** No stars, no marks out of ten, no "voto", no condition scale ("ottime / buone /
  variabili / difficili / fuori condizione" as a verdict). People say in words how the day was.
- **Stay inside what the place is.** Use the measured facts you are given (height, the way the
  ground faces, comune, the OpenStreetMap tags). Do not contradict them. A crag at 1,500 m facing
  east is not climbed in the sun on a January afternoon. Do not invent named hamlets, roads,
  huts or bars you are not sure exist: say "dal paese", "dalla statale", "dal parcheggio".
- **Days** are between 2022-03-01 and 2026-11-15, in the season the place is actually done,
  more often on weekends and in good months — but about a quarter on weekdays, as on a real
  archive (holidays, days off, people who work shifts) — never two reports with the same words.

## What to write, per place

One JSON file per place, `scripts/demo/phase0-content/<osm>.json`, exactly this shape:

```json
{
  "osm": "w1096333248",
  "invented": ["avvicinamento", "vie", "description", "reports"],
  "itinerary": {
    "key": "corno-di-machaby",
    "activity": "falesia",
    "place": "comune-007004",
    "name": "Corno di Machaby",
    "lat": 45.64, "lon": 7.75,
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

- `key`: lowercase slug of the name. `place`: `comune-` + the place's `istat` code. `lat`, `lon`:
  as given. `aspect` and `facts.esposizione`: one of `N NE E SE S SO O NO` (Italian: O is west).
  Where the given `slopeDeg` is under 15, the measured aspect means nothing: choose a plausible one
  and list `esposizione` in `invented`. `altMax`: the given `eleDem`.
- `invented`: every fact, section and list you made up rather than took from what you were given.
- `readings` has exactly one entry per report, **in the same order as `reports`**.

### Facts and sections by activity

**falesia** (a crag):
- `facts`: `esposizione` (required), `quota_base` (required, metres, the given `eleDem`),
  `avvicinamento` (minutes on foot from the car, a number), optionally `localita_partenza`
  (only the comune's name or a place you are sure of), `come_arrivare`, `parcheggio_nota`.
- `sections`: `note` (the description: rock, style, bolting, sun and shade, what to bring, 2–5
  short paragraphs), `avvicinamento` (the walk in, 1 paragraph).
- `parts`: the routes, each `{ "group": "<sector>", "fields": { "nome": "…", "grado": "6a+",
  "lunghezza": 25 } }`. Grades are French sport grades `3a`…`9a`, with optional `+`. Respect the
  OpenStreetMap tags when they give a min/max grade, lengths, or a number of routes. Route names
  are invented, Italian or dialect or jokes, as real crags have; a few routes may have no name
  (leave `nome` out). Sizes: star 50–70 routes in 4–6 sectors, classic 25–40, regular 12–25,
  quiet and untouched 6–15.

**escursionismo** (a hike), **via_ferrata**, **sci_alpinismo**:
- `facts` (escursionismo, sci_alpinismo only, all optional): `difficolta` (escursionismo `T`,
  `E`, `EE`; sci_alpinismo `MS`, `BS`, `OS`), `partenza` (metres, the given `eleDem`), `vetta`,
  `dislivello` only if you can derive them honestly from the tags (`from`, `to`, `distance`),
  `esposizione`, `localita_partenza`.
- `via_ferrata` has no facts: leave `facts` empty.
- `sections`: `descrizione` (the route: 2–5 paragraphs), optionally `note`; via_ferrata also
  `avvicinamento`.
- No `parts`.

### Reports, by tier

| Tier | Reports | Length |
|---|---|---|
| star | 40–50 | from one line to a long paragraph; most 2–5 sentences |
| classic | 15–20 | 1–6 sentences |
| regular | 4–8 | 1–4 sentences |
| quiet | 1–3 | 1–2 sentences |
| untouched | none: `reports` and `readings` are `[]` | |

What people write about: the day (sun, wind, wet rock after rain, cold in the shade, heat), the
approach, the rock and the bolting, which routes they did and how they felt, crowds, dogs, kids,
the parking, a hornet nest, a fallen tree, the view, a beer after. Mix it. Not every report
mentions every theme; most mention two or three things.

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

Run the checker on your files and fix everything it reports:

```
node --disable-warning=ExperimentalWarning scripts/demo/phase0-check.ts scripts/demo/phase0-content/<osm>.json …
```
