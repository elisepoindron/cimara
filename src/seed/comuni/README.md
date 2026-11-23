# Every Italian comune

`src/seed/data/places.json` holds every comune in Italy (7,896 as of November
2026), under its province and region, with the position of its town centre.
Find needs both: a word is a place only because a place by that name exists, and
"entro 30 km da Susa" needs to know where Susa is.

It is built by `build.ts` from two public sources, each used for what it is
right about:

| Source | What it gives | Licence |
|---|---|---|
| [ISTAT, Elenco dei comuni italiani](https://www.istat.it/classificazione/codici-dei-comuni-delle-province-e-delle-regioni/) | names in Italian, province code, region, ISTAT code | CC BY 4.0 |
| [GeoNames, IT.zip](https://download.geonames.org/export/dump/) | the seat of each comune (`PPLC`, `PPLA`, `PPLA2`, `PPLA3`), tagged with its ISTAT code | CC BY 4.0 |

GeoNames alone would do for positions but not for names: it writes the large
cities in English (`Turin`) and the regions too (`Piedmont`). ISTAT alone has no
positions. The two are joined on the ISTAT code. A seat is used rather than the
middle of the comune's area, because in the mountains the middle is often a
summit, and a climber measures from the town they drive to.

## Rebuilding

When ISTAT publishes a new list (comuni merge most years):

```
curl -LO https://www.istat.it/storage/codici-unita-amministrative/Elenco-comuni-italiani.csv
curl -O https://download.geonames.org/export/dump/IT.zip && unzip IT.zip
node src/seed/comuni/build.ts Elenco-comuni-italiani.csv IT.txt
```

Keep the downloads out of the repository. The tool refuses, by name, any ISTAT
row it cannot read. A comune GeoNames has no seat for is kept without a position
and listed at the end of the run; it is never given one.

## How the seed uses it

`seed.ts` loads `places.json` last. It adds what the hand-written files leave
out and fills in a position where a place has none, but never moves a position
set by hand: the mockups measure their distances from those, and the acceptance
tests hold the pages to them. Places are matched by name, kind and parent, so
the two Samone (TO and TN) stay two.

Both sources ask to be credited. The `source` line at the top of `places.json`
does so; keep it if the file is rebuilt.
