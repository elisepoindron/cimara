/**
 * Builds `src/seed/data/places.json`: every Italian comune, under its province
 * and region, with the position of its town centre. Run by hand when ISTAT
 * publishes a new list — see README.md beside this file.
 *
 *   node src/seed/comuni/build.ts path/to/Elenco-comuni-italiani.csv path/to/IT.txt
 *
 * Two sources, each for what it is right about. ISTAT for the names and the
 * hierarchy: the official list, in Italian. GeoNames for the point: its comune
 * seats carry the ISTAT code, and are the town a climber drives from rather than
 * the middle of the comune's area, which in the mountains is often a summit.
 *
 * A comune GeoNames has no seat for is kept without a position — a place Find
 * still reads, and cannot measure a distance from — rather than given one.
 */
import { readFile, writeFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

export interface SeedPlace {
  readonly key: string
  readonly name: string
  readonly kind: 'regione' | 'provincia' | 'comune'
  readonly parent?: string
  readonly lat?: number
  readonly lon?: number
}

export interface Built {
  readonly places: readonly SeedPlace[]
  /** Comuni with no GeoNames seat, by name: kept, without a position. */
  readonly unplaced: readonly string[]
}

/** A semicolon CSV as ISTAT writes it: quoted fields may hold newlines and doubled quotes. */
export function parseCsv(text: string, separator = ';'): string[][] {
  const rows: string[][] = []
  let row: string[] = []
  let field = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { field += '"'; i++ }
      else if (ch === '"') quoted = false
      else field += ch
    } else if (ch === '"') quoted = true
    else if (ch === separator) { row.push(field); field = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(field); field = ''
      if (row.some(f => f !== '')) rows.push(row)
      row = []
    } else field += ch
  }
  row.push(field)
  if (row.some(f => f !== '')) rows.push(row)
  return rows
}

/** The column whose header starts with `name`; ISTAT's headers carry footnote marks and line breaks. */
function column(header: readonly string[], name: string): number {
  const i = header.findIndex(h => h.replace(/\s+/g, ' ').trim().startsWith(name))
  if (i < 0) throw new Error(`ISTAT list: no column "${name}"`)
  return i
}

/** "Trentino-Alto Adige/Südtirol" is "Trentino-Alto Adige": the Italian half, as the product is Italian. */
function italianOf(name: string): string {
  return name.split('/')[0]!.trim()
}

/** GeoNames feature codes for a comune's seat, the capital's first. */
const SEATS = ['PPLC', 'PPLA', 'PPLA2', 'PPLA3']

/** The seat of every comune GeoNames knows, by ISTAT code. */
export function seatsOf(geonames: string): Map<string, { lat: number; lon: number }> {
  const best = new Map<string, { lat: number; lon: number; rank: number }>()
  for (const line of geonames.split('\n')) {
    const f = line.split('\t')
    const rank = SEATS.indexOf(f[7] ?? '')
    const code = f[12] ?? ''
    if (rank < 0 || !/^\d{6}$/.test(code)) continue
    const lat = Number(f[4])
    const lon = Number(f[5])
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue
    const seen = best.get(code)
    if (!seen || rank < seen.rank) best.set(code, { lat, lon, rank })
  }
  return new Map([...best].map(([code, { lat, lon }]) => [code, { lat, lon }]))
}

export function build(istatCsv: string, geonames: string): Built {
  const [header, ...rows] = parseCsv(istatCsv)
  if (!header) throw new Error('ISTAT list: empty')
  const col = {
    code: column(header, 'Codice Comune formato alfanumerico'),
    name: column(header, 'Denominazione in italiano'),
    regionCode: column(header, 'Codice Regione'),
    region: column(header, 'Denominazione Regione'),
    sigla: column(header, 'Sigla automobilistica'),
  }
  const seats = seatsOf(geonames)

  const regions = new Map<string, SeedPlace>()
  const provinces = new Map<string, SeedPlace>()
  const comuni: SeedPlace[] = []
  const unplaced: string[] = []

  for (const r of rows) {
    const code = r[col.code]?.trim() ?? ''
    const name = r[col.name]?.trim() ?? ''
    const regionCode = r[col.regionCode]?.trim() ?? ''
    const region = italianOf(r[col.region] ?? '')
    const sigla = r[col.sigla]?.trim() ?? ''
    // Refused by name, never patched: the person who rebuilds this is the one
    // who has to look at the source.
    if (!/^\d{6}$/.test(code) || name === '' || region === '' || !/^[A-Z]{2}$/.test(sigla)) {
      throw new Error(`ISTAT list: cannot read row ${JSON.stringify(r.slice(0, 8))}`)
    }

    const regionKey = `regione-${regionCode}`
    if (!regions.has(regionKey)) regions.set(regionKey, { key: regionKey, name: region, kind: 'regione' })
    const provinceKey = `provincia-${sigla}`
    if (!provinces.has(provinceKey)) {
      provinces.set(provinceKey, { key: provinceKey, name: sigla, kind: 'provincia', parent: regionKey })
    }

    const seat = seats.get(code)
    if (!seat) unplaced.push(name)
    comuni.push({
      key: `comune-${code}`, name, kind: 'comune', parent: provinceKey,
      ...(seat ? { lat: round5(seat.lat), lon: round5(seat.lon) } : {}),
    })
  }

  const byName = (a: SeedPlace, b: SeedPlace) => a.name.localeCompare(b.name, 'it') || a.key.localeCompare(b.key)
  return {
    places: [...[...regions.values()].sort(byName), ...[...provinces.values()].sort(byName), ...comuni.sort(byName)],
    unplaced,
  }
}

/** A metre is five decimals of a degree; more is noise in a file this size. */
function round5(n: number): number {
  return Math.round(n * 1e5) / 1e5
}

/** One place per line: a file a diff can be read in when ISTAT changes it. */
export function serialise(built: Built): string {
  const lines = built.places.map(p => `    ${JSON.stringify(p)}`)
  return `{
  "source": "Comuni: ISTAT, Elenco dei comuni italiani (CC BY 4.0). Positions: GeoNames, geonames.org (CC BY 4.0). Built by src/seed/comuni/build.ts.",
  "places": [
${lines.join(',\n')}
  ]
}
`
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  const [csvPath, geonamesPath] = process.argv.slice(2)
  if (!csvPath || !geonamesPath) {
    console.error('usage: node src/seed/comuni/build.ts Elenco-comuni-italiani.csv IT.txt')
    process.exit(1)
  }
  // ISTAT publishes the list in Latin-1.
  const csv = new TextDecoder('latin1').decode(await readFile(csvPath))
  const built = build(csv, await readFile(geonamesPath, 'utf8'))
  const out = join(dirname(fileURLToPath(import.meta.url)), '..', 'data', 'places.json')
  await writeFile(out, serialise(built))
  const comuni = built.places.filter(p => p.kind === 'comune').length
  console.log(`${comuni} comuni, ${comuni - built.unplaced.length} with a position, written to ${out}`)
  if (built.unplaced.length > 0) console.log(`without a position: ${built.unplaced.join(', ')}`)
}
