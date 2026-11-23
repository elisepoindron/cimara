import type { ImportResult } from './run.ts'

/**
 * What the run did, as text somebody can act on.
 *
 * Written for the person holding the source file, so every line says where to
 * go and look: the row by its position in the export, the column by the name
 * the export gave it, and what was in it as it was written. "Row 14 is bad" is
 * not a report.
 *
 * English, like every other thing in this repository a designer or an operator
 * reads. The Italian in it is quotation — `riga` numbers the export's own rows,
 * `titolo` and `diff` are the source's column names, and a route's name is its
 * name. Translating those would send somebody looking for a column that is not
 * there.
 */
export function reportOf(result: ImportResult): string {
  const rows = new Set(result.refused.map(r => r.riga)).size
  const lines: string[] = [
    `${result.written} written, ${result.skipped.length} already in the archive, `
    + `${rows} refused.`,
  ]

  if (result.skipped.length > 0) {
    lines.push('', 'Already in the archive, so nothing was written:')
    for (const s of result.skipped) {
      lines.push(`  riga ${s.riga}, ${s.name} (${s.place}) — already held as ${s.itineraryId}`)
    }
  }

  if (result.interpreted.length > 0) {
    // Written, but not as the source wrote them: a rule chose the value. Said
    // here so the archive never looks more certain than its source was.
    lines.push('', `Written, but read through a rule — check these against the source `
      + `(${result.interpreted.length}):`)
    for (const n of result.interpreted) {
      lines.push(`  riga ${n.riga}, ${n.field}: ${n.found} read as ${n.readAs}`)
    }
  }

  if (result.reading) {
    const { asked, unread } = result.reading
    lines.push('', `The model read ${asked - unread} of the ${asked} new rows with prose`
      + (unread > 0 ? `; ${unread} could not be read and were sorted by the word rule alone.` : '.'))
  }

  if (result.suggested.length > 0) {
    // Nothing here was moved. The model is right about these often enough to
    // be worth reading and wrong often enough never to be applied: a person decides, and fixes
    // the source or the page by hand.
    lines.push('', `Suggested by the model, and nothing was moved — decide these yourself `
      + `(${result.suggested.length}):`)
    for (const s of result.suggested) {
      const as = s.to === 'fact' && s.fact ? `fact (${s.fact})` : s.to
      lines.push(`  riga ${s.riga}, ${s.field}: ${JSON.stringify(s.sentence)} reads as ${as}`)
    }
  }

  if (result.refused.length > 0) {
    // The count of reasons, not of rows: a row with three unreadable columns
    // appears three times, and each line is a separate thing to go and fix.
    lines.push('', `Refused, and nothing was invented to make them fit `
      + `(${result.refused.length} in ${rows} rows):`)
    for (const r of result.refused) {
      lines.push(`  riga ${r.riga}, ${r.field}: ${r.reason} (found: ${r.found})`)
    }
  }

  return lines.join('\n')
}
