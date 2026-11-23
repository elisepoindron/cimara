import { NEVER_NAMED } from './never-named.ts'
import type { OsmImportResult } from './run.ts'

/** How many examples of each refusal the text report shows; the JSON beside it holds them all. */
const EXAMPLES = 5

function countBy<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

/**
 * What the run did, for the person holding the extract: what was taken per
 * activity, what still needs writing, what was skipped and every reason
 * something was refused, with how many and a few examples by OpenStreetMap id,
 * so each can be looked up on osm.org and fixed at the source.
 */
export function osmReportOf(result: OsmImportResult): string {
  const lines: string[] = [
    `${result.places.length} places taken: ${result.written.length} written, `
    + `${result.waiting.length} waiting for written content; `
    + `${result.skipped.length} skipped; ${result.refused.length} refused.`,
    '', 'Taken, by activity (written / waiting):',
  ]
  const acts = new Set(result.places.map(p => p.activity))
  for (const a of [...acts].sort()) {
    const w = result.written.filter(p => p.activity === a).length
    const q = result.waiting.filter(p => p.activity === a).length
    const held = result.places.filter(p => p.activity === a).length - w - q
    lines.push(`  ${a}: ${w} / ${q}${held ? ` (and ${held} already in the database)` : ''}`)
  }

  if (result.waiting.length > 0) {
    lines.push('', 'Still to be written before they can be pages (Phase 3 writes them, and says so):')
    for (const [need, n] of countBy(result.waiting.flatMap(p => p.needs), x => x)) lines.push(`  ${need}: ${n}`)
  }

  const fromTerrain = result.places.filter(p => p.measured.esposizione?.from.startsWith('terrain')).length
  const fromTag = result.places.filter(p => p.measured.esposizione?.from === 'climbing:orientation').length
  if (fromTerrain + fromTag > 0) {
    lines.push('', `Aspect read from climbing:orientation on ${fromTag} crags, measured from the terrain on ${fromTerrain}.`)
  }
  if (result.grouped.length > 0) {
    const areas = new Set(result.grouped.map(g => g.area)).size
    lines.push(`Boulders listed under the area OpenStreetMap puts them in: ${result.grouped.length}, in ${areas} areas.`)
  }
  const fromRef = result.places.filter(p => p.nameFrom === 'ref').length
  if (fromRef > 0) lines.push(`Named from their ref, having no name: ${fromRef} routes ("Sentiero <ref>").`)

  if (result.skipped.length > 0) {
    lines.push('', `Skipped, one name in one comune taken once (${result.skipped.length}):`)
    for (const s of result.skipped.slice(0, EXAMPLES)) lines.push(`  ${s.osm}, ${s.name} (${s.comune}) — held as ${s.heldAs}`)
    if (result.skipped.length > EXAMPLES) lines.push(`  … and ${result.skipped.length - EXAMPLES} more`)
  }

  if (result.refused.length > 0) {
    lines.push('', 'Refused, and nothing was invented to make them fit:')
    const groups = countBy(result.refused, r => `${r.field}: ${r.reason}`)
    for (const [reason, n] of groups) {
      lines.push(`  ${n} × ${reason}`)
      const examples = result.refused.filter(r => `${r.field}: ${r.reason}` === reason).slice(0, EXAMPLES)
      for (const r of examples) lines.push(`      ${r.osm}${r.name ? `, ${r.name}` : ''} (found: ${r.found})`)
    }
  }

  // The last lock: whatever slipped past the extract and the translator, the
  // report never carries the name.
  return lines.join('\n').replace(new RegExp(NEVER_NAMED.source, 'gi'), '(withheld)')
}

/** Refusals per reason, as a table for the plan. */
export function refusalCounts(result: OsmImportResult): [string, number][] {
  return countBy(result.refused, r => `${r.field}: ${r.reason}`)
}
