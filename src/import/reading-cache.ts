import { appendFileSync, existsSync, readFileSync } from 'node:fs'
import { createHash } from 'node:crypto'
import type { ReadRow, RowReading } from './reading.ts'

/**
 * A model's readings, kept beside the export so a second run asks nothing.
 *
 * An import is meant to be run again — after fixing what the first run
 * refused — and a reading costs money and is not certain to come back the
 * same twice. So each one is written down the moment it arrives, keyed by the
 * words it read and by `version`, which names the question asked: change the
 * question and every row is read again, change a row's words and that row is.
 *
 * One JSON line per reading, appended: a run stopped halfway keeps what it
 * had paid for. A reading that failed is not kept, so the next run tries again.
 */
export function cachedReader(read: ReadRow, file: string, version: string): ReadRow {
  const known = new Map<string, RowReading>()
  if (existsSync(file)) {
    for (const line of readFileSync(file, 'utf8').split('\n')) {
      if (line.trim() === '') continue
      try {
        const entry = JSON.parse(line) as { key?: unknown; reading?: unknown }
        if (typeof entry.key === 'string' && entry.reading) known.set(entry.key, entry.reading as RowReading)
      } catch {
        // A line cut short by a stopped run: that row is simply read again.
      }
    }
  }

  return async boxes => {
    const key = keyOf(version, boxes)
    const kept = known.get(key)
    if (kept) return kept
    const reading = await read(boxes)
    if (reading !== null) {
      known.set(key, reading)
      appendFileSync(file, JSON.stringify({ key, reading }) + '\n')
    }
    return reading
  }
}

/** The question and the words, in a fixed order, hashed. */
function keyOf(version: string, boxes: Readonly<Record<string, string>>): string {
  const ordered = Object.keys(boxes).sort().map(k => [k, boxes[k]])
  return createHash('sha256').update(JSON.stringify([version, ordered])).digest('hex')
}
