import { readFile } from 'node:fs/promises'

/** A row exactly as the foreign file holds it. Nothing here is judged or coerced. */
export interface ForeignRow {
  readonly riga: number          // 1-based line in the source, for the report
  readonly [field: string]: unknown
}

/**
 * The file could not be read as an export. This is the only thing reading can
 * fail on: a row is never wrong here, only unreadable later.
 */
export class SourceError extends Error {}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/**
 * Every row of a foreign archive export, numbered.
 *
 * Parsing is not validation. Nothing here asks whether a row has a title, a
 * place, a grade on any scale or a date that is a day: a row with none of them
 * is still a row, and refusing it is `translate`'s job, where the reason can be
 * named and reported. The reader that quietly drops the rows it dislikes is the
 * reader that makes an import look complete when it is not.
 *
 * Values arrive exactly as the file wrote them — `"820"` stays a string,
 * `820` stays a number — because the difference is evidence about the source,
 * and coercing it here would hide what the translator has to decide about.
 */
export async function readSource(path: string): Promise<readonly ForeignRow[]> {
  let text: string
  try {
    text = await readFile(path, 'utf8')
  } catch (err) {
    throw new SourceError(`cannot read the archive at ${path}: ${(err as Error).message}`,
      { cause: err })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch (err) {
    throw new SourceError(`${path} is not JSON: ${(err as Error).message}`, { cause: err })
  }

  const records = isRecord(parsed) ? parsed['itinerari'] : undefined
  if (!Array.isArray(records)) {
    throw new SourceError(
      `${path} holds no "itinerari" array: this is not an archive export`)
  }

  return records.map((record, i) => {
    const riga = i + 1
    if (!isRecord(record)) {
      throw new SourceError(
        `${path}, riga ${riga}: expected a record, found ${JSON.stringify(record)}`)
    }
    // Our numbering wins over any column of the same name: `riga` is where the
    // report will send somebody to look, and that is this file's position in
    // this export, not whatever the source once called a row.
    return { ...record, riga }
  })
}
