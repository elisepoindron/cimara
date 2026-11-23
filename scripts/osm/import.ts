/**
 * The public demo's OpenStreetMap import.
 *
 *   DATABASE_FILE=build/demo.db node scripts/osm/import.ts [extract-dir] [places-out.json]
 *
 * Reads the extract scripts/osm/extract.ts wrote (default data/osm/extract/),
 * writes every complete place into DATABASE_FILE through src/db/, and writes
 * every place taken — complete or still needing written content — to
 * data/osm/places.json for Phase 3's writers, with the refusals beside it.
 *
 * Run by hand, and only into a demo database: it refuses to start when
 * DATABASE_FILE is unset or names the app's default database (the private
 * archive), and refuses a database that holds accounts or gite. It never runs
 * at start, at deploy or from the seed.
 */
import { copyFile, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertHoldsNobody, demoDatabaseFile, NotADemoDatabase } from '../../src/import/osm/guard.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

let file: string
try {
  file = demoDatabaseFile(process.env)
} catch (err) {
  if (!(err instanceof NotADemoDatabase)) throw err
  console.error(`Refused: ${err.message}.`)
  process.exit(2)
}

// Only now is anything that opens a database loaded.
const { openDb } = await import('../../src/db/open.ts')
const { migrate } = await import('../../db/migrate.ts')
const { seed } = await import('../../src/seed/seed.ts')
const { readExtract } = await import('../../src/import/osm/source.ts')
const { importOsm, osmVocabulary } = await import('../../src/import/osm/run.ts')
const { osmReportOf } = await import('../../src/import/osm/report.ts')
const { tellNamesApart } = await import('../../src/import/osm/names.ts')
const { NEVER_NAMED } = await import('../../src/import/osm/never-named.ts')

const extractDir = process.argv[2] ?? join(ROOT, 'data', 'osm', 'extract')
const placesOut = process.argv[3] ?? join(ROOT, 'data', 'osm', 'places.json')
const refusedOut = placesOut.replace(/\.json$/, '') + '-refused.json'
const SHARED = ['places.json', 'stazioni-meteo.json']
const gazetteer = join(ROOT, 'src', 'seed', 'data', 'places.json')

const manifest = JSON.parse(await readFile(join(extractDir, 'manifest.json'), 'utf8')) as { extracted: string }
const db = openDb(file)
try {
  await migrate(db)
  try {
    await assertHoldsNobody(db, file)
  } catch (err) {
    if (!(err instanceof NotADemoDatabase)) throw err
    console.error(`Refused: ${err.message}.`)
    process.exit(2)
  }

  // The files every archive shares — the comuni and the weather stations —
  // and nothing of the private archive's own.
  const shared = await mkdtemp(join(tmpdir(), 'osm-shared-'))
  try {
    for (const f of SHARED) await copyFile(join(ROOT, 'src', 'seed', 'data', f), join(shared, f))
    await seed(db, shared)
  } finally {
    await rm(shared, { recursive: true, force: true })
  }

  const read = await readExtract(extractDir)
  const known = await osmVocabulary(db, gazetteer, `${manifest.extracted}T00:00:00.000Z`)
  const extract = { ...read, rows: tellNamesApart(read.rows, known) }
  const result = await importOsm(db, extract.rows, known)

  // The tracks are in the extract and, once written, in the database: the
  // writers need to know a place has one, not its points.
  const forWriters = result.places.map(({ track, ...p }) => ({ ...p, track: track !== null }))
  const placesJson = JSON.stringify({ extracted: manifest.extracted, osmBase: extract.osmBase, places: forWriters }, null, 0)
    .replace(/\{"osm"/g, '\n{"osm"') + '\n'
  const refusedJson = JSON.stringify(result.refused).replace(/\{"osm"/g, '\n{"osm"') + '\n'
  // Nothing written may name the site the demo never names.
  for (const [path, text] of [[placesOut, placesJson], [refusedOut, refusedJson]] as const) {
    if (NEVER_NAMED.test(text)) throw new Error(`${path} would name a site the demo never names: nothing written`)
  }
  await writeFile(placesOut, placesJson)
  await writeFile(refusedOut, refusedJson)

  console.log(osmReportOf(result))
  console.log(`\nPlaces for Phase 3: ${placesOut}\nEvery refusal: ${refusedOut}`)
} finally {
  await db.close()
}
