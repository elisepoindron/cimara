import { fileURLToPath } from 'node:url'
import { openDb } from './src/db/open.ts'
import { databaseFile } from './src/seed/brand.ts'
import { runImport } from './src/import/run.ts'
import { reportOf } from './src/import/report.ts'
import { cachedReader } from './src/import/reading-cache.ts'
import type { ReadRow } from './src/import/reading.ts'

/**
 * Import a foreign archive.
 *
 *     npm run import                       the synthetic archive
 *     npm run import -- path/to/altro.json  somebody else's
 *
 * Prints what arrived, what was already there and what could not be read.
 *
 * Refusing rows is the ordinary outcome, not a failure: a twenty-year-old
 * archive of 35,000 routes will always hold some nobody can read, and an import
 * that reports the normal case as an error teaches you to ignore the error. So
 * it exits non-zero only when it could not do its job at all — when not one row
 * was readable, which means the format is wrong rather than the data.
 *
 * Migrate first. This writes through the same repository functions the seed and
 * the composer use, so it needs the schema they need.
 */
const DEFAULT = fileURLToPath(new URL('./src/import/data/archivio.json', import.meta.url))

if (import.meta.filename === process.argv[1]) {
  const path = process.argv[2] ?? DEFAULT
  const db = openDb(databaseFile())

  // With a key, Haiku reads each new row's prose: it decides where an
  // approach's road and parking end, under a check, and its other remarks are
  // listed for you, never applied. Its readings are kept beside the export,
  // so running the import again asks nothing twice. Without a key, the word
  // rule alone.
  const apiKey = process.env.ANTHROPIC_API_KEY
  let read: ReadRow | undefined
  if (apiKey) {
    const { realReadRow, IMPORT_READING_VERSION } = await import('./src/import/ai-reading.ts')
    read = cachedReader(realReadRow(apiKey), `${path}.readings.jsonl`, IMPORT_READING_VERSION)
  } else {
    console.log('ANTHROPIC_API_KEY is not set: approaches are sorted by the word rule alone, and nothing is suggested.\n')
  }

  const result = await runImport(db, path, read)
  console.log(reportOf(result))
  await db.close()

  // Nothing readable at all: this is the wrong file, or the wrong shape of file,
  // and no amount of fixing individual rows will help.
  if (result.written === 0 && result.skipped.length === 0) process.exitCode = 1
}
