/**
 * The public demo's database.
 *
 *   DATABASE_FILE=build/demo.db npm run demo:build [-- --content <dir>] [--only <ids.json> | --all]
 *
 * Builds a fresh database from what the repository holds: the shared seed
 * files, the OpenStreetMap extract (data/osm/extract/), the written content
 * (src/seed/sets/demo/content/, or `--content`), and each route's themes from
 * the recorded readings. The places without content are those Phase 3 chose,
 * in src/seed/sets/demo/tiers/tiers.json; `--only` names another JSON list of
 * OpenStreetMap ids instead, and `--all` takes every place the importer can
 * write. Every place with content is always in. Report photos go to UPLOADS_DIR, by default a folder beside the
 * database (build/demo-uploads for build/demo.db).
 *
 * Fresh means fresh: an existing file at DATABASE_FILE is replaced, but only
 * after it is shown to hold nobody. It refuses an unset DATABASE_FILE, the
 * app's default database (the private archive), and any database holding
 * accounts or gite. A build that fails leaves no database behind.
 */
import { existsSync } from 'node:fs'
import { mkdir, readFile, rm } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { assertHoldsNobody, demoDatabaseFile, NotADemoDatabase } from '../../src/import/osm/guard.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')

const refuse = (err: unknown): never => {
  if (!(err instanceof NotADemoDatabase)) throw err
  console.error(`Refused: ${err.message}.`)
  process.exit(2)
}

let file: string
try {
  file = demoDatabaseFile(process.env)
} catch (err) {
  file = refuse(err)
}
if (file === ':memory:') refuse(new NotADemoDatabase('DATABASE_FILE is :memory:, which a build cannot leave behind: name a file'))

const arg = (name: string): string | undefined => {
  const i = process.argv.indexOf(name)
  return i >= 0 ? process.argv[i + 1] : undefined
}
const contentDir = resolve(arg('--content') ?? join(ROOT, 'src', 'seed', 'sets', 'demo', 'content'))
const onlyFile = arg('--only')
const everything = process.argv.includes('--all')
const tiersFile = join(ROOT, 'src', 'seed', 'sets', 'demo', 'tiers', 'tiers.json')
const uploadsDir = resolve(process.env.UPLOADS_DIR ?? file.replace(/\.db$/, '') + '-uploads')
if (uploadsDir === resolve(ROOT, 'uploads')) {
  refuse(new NotADemoDatabase(`UPLOADS_DIR is ${uploadsDir}, the private archive's photos: name another folder`))
}

// Only now is anything that opens a database loaded.
const { openDb } = await import('../../src/db/open.ts')
const { migrate } = await import('../../db/migrate.ts')
const { filesystemPhotoStore } = await import('../../src/app/photo-store.ts')
const { buildDemo, demoReportOf, DemoContentError, selectionFromTiers, starsFromTiers } = await import('../../src/demo/build.ts')

const removeDb = async () => {
  for (const suffix of ['', '-wal', '-shm']) await rm(file + suffix, { force: true })
}

if (existsSync(file)) {
  // Shown to hold nobody before it is replaced.
  const old = openDb(file)
  try {
    await migrate(old)
    await assertHoldsNobody(old, file)
  } catch (err) {
    await old.close()
    refuse(err)
  }
  await old.close()
  await removeDb()
}
await rm(uploadsDir, { recursive: true, force: true })
await mkdir(dirname(resolve(file)), { recursive: true })

const only = everything ? undefined
  : onlyFile ? new Set(JSON.parse(await readFile(onlyFile, 'utf8')) as string[])
  : existsSync(tiersFile) ? selectionFromTiers(JSON.parse(await readFile(tiersFile, 'utf8')))
  : undefined
const starred = existsSync(tiersFile) ? starsFromTiers(JSON.parse(await readFile(tiersFile, 'utf8'))) : []
const db = openDb(file)
let ok = false
try {
  await migrate(db)
  const result = await buildDemo(db, {
    extractDir: join(ROOT, 'data', 'osm', 'extract'),
    gazetteer: join(ROOT, 'src', 'seed', 'data', 'places.json'),
    contentDir,
    photosDir: join(dirname(contentDir), 'photos'),
    photos: filesystemPhotoStore(uploadsDir),
    ...(only ? { only } : {}),
    starred,
  })
  console.log(demoReportOf(result))
  console.log(`\nDatabase: ${file}${result.seeded.photos ? `\nPhotos: ${uploadsDir}` : ''}`)
  ok = true
} catch (err) {
  if (!(err instanceof DemoContentError)) throw err
  console.error(err.message)
  process.exitCode = 1
} finally {
  await db.close()
  if (!ok) await removeDb()
}
