/**
 * The public demo's database, built once, ahead of time.
 *
 * Into a migrated, empty database, in this order:
 *
 *   1. the files every archive shares — the comuni and the weather stations;
 *   2. every place with a content file: the importer's own translation says
 *      what OpenStreetMap measured and what is still needed, the content is laid
 *      over it (`compose`), and the seed writes it, reports and photos included;
 *   3. every other place of the extract, through the importer as it stands: a
 *      place that still needs a written fact (a crag with no vie) is left out;
 *   4. each written place's themes, read by the app's own `regenerateSynthesis`
 *      from the recorded readings (`replayedModel`), so every quote is grounded
 *      as in production and saved with the current `READING`: the public deploy,
 *      which has no key, never reads anything again.
 *
 * Content comes before the measured-only places because the seed finds a route
 * by its name alone: written first, no other place can be mistaken for one.
 *
 * A content file that names no place, a place the importer refuses, or a value
 * that contradicts a measured one stops the build with every problem named,
 * before anything is written past the shared files.
 */
import { mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import type { Db } from '../db/open.ts'
import { findItineraryByNameInPlace } from '../db/itinerary.ts'
import { saveTrack } from '../db/track.ts'
import { synthesisFor } from '../db/synthesis.ts'
import { seed, SHARED_DIR } from '../seed/seed.ts'
import type { PhotoStore } from '../app/photo-store.ts'
import { regenerateSynthesis } from '../app/synthesis.ts'
import { readExtract, type OsmRow } from '../import/osm/source.ts'
import { tellNamesApart } from '../import/osm/names.ts'
import { importOsm, osmVocabulary, type OsmImportResult } from '../import/osm/run.ts'
import { translateOsm, type DemoPlace } from '../import/osm/translate.ts'
import { compose, readContent, type ContentFile, type DemoItinerary } from './content.ts'
import { replayedModel } from './replayed-model.ts'

export interface DemoBuildInput {
  /** The extract scripts/osm/extract.ts wrote: data/osm/extract/. */
  readonly extractDir: string
  /** The comuni gazetteer, src/seed/data/places.json. */
  readonly gazetteer: string
  /** One content file per place: src/seed/sets/demo/content/. Absent or empty is no content. */
  readonly contentDir: string
  /** The shared seed files: src/seed/data/ by default. */
  readonly sharedDir?: string
  /** Where the content's report photos and their `credits.json` are read from. */
  readonly photosDir?: string
  /** Where their bytes are written; without one, a report's photos are refused rather than lost. */
  readonly photos?: PhotoStore | null
  /**
   * The places of the extract the archive holds besides those with content,
   * by OpenStreetMap id: the selection. Absent, every place the importer takes.
   */
  readonly only?: ReadonlySet<string>
  readonly now?: Date
}

/** A place with a content file that the build did not write, and why. */
export interface DemoLeftOut {
  readonly osm: string
  readonly name: string
  readonly activity: string
  readonly needs: readonly string[]
  /** The content file it had, if any: a file that supplies too little is named. */
  readonly file: string | null
}

export interface DemoBuildResult {
  /** Places written from a content file, by activity. */
  readonly withContent: readonly { osm: string; name: string; activity: string; reports: number }[]
  /** The importer's run over the places without content. */
  readonly measured: OsmImportResult
  readonly leftOut: readonly DemoLeftOut[]
  readonly themes: { readonly itineraries: number; readonly themes: number; readonly flags: number; readonly reports: number }
  readonly seeded: Record<string, number>
  /** The selection, where there was one: how many places it chose, and those the extract does not hold. */
  readonly selection: { readonly chosen: number; readonly notInExtract: readonly string[] } | null
}

/**
 * The places Phase 3 chose, by OpenStreetMap id, from its tiers file
 * (src/seed/sets/demo/tiers/tiers.json, written by scripts/demo/phase3-tiers.ts):
 * every tier's places, untouched ones included. A file without tiers is refused,
 * not read as choosing nothing.
 */
export function selectionFromTiers(doc: unknown): Set<string> {
  const tiers = (doc as { tiers?: unknown } | null)?.tiers
  if (typeof tiers !== 'object' || tiers === null) throw new Error('the tiers file holds no "tiers"')
  const ids = new Set<string>()
  for (const [tier, list] of Object.entries(tiers)) {
    if (!Array.isArray(list)) throw new Error(`the tiers file's ${tier} is not a list`)
    for (const [i, p] of list.entries()) {
      if (typeof p?.osm !== 'string') throw new Error(`the tiers file's ${tier}[${i}] has no osm id`)
      ids.add(p.osm)
    }
  }
  return ids
}

/** A content file that cannot be built, with every problem named. Nothing past the shared files is written. */
export class DemoContentError extends Error {
  readonly problems: readonly string[]
  constructor(problems: readonly string[]) {
    super(`the demo's content cannot be built (${problems.length} problem${problems.length === 1 ? '' : 's'}):\n  `
      + problems.join('\n  '))
    this.problems = problems
  }
}

/** A climbing place's line is its wall or its pitches, not a way to walk (as `importOsm` writes it). */
const CLIMBING = new Set(['falesia', 'multipitch', 'bouldering'])

async function readContentDir(dir: string): Promise<{ file: string; content: ContentFile }[]> {
  let names: string[]
  try {
    names = (await readdir(dir)).filter(f => f.endsWith('.json')).sort()
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return []
    throw err
  }
  const problems: string[] = []
  const out: { file: string; content: ContentFile }[] = []
  for (const file of names) {
    const read = readContent(await readFile(join(dir, file), 'utf8'))
    if (!read.ok) { problems.push(...read.problems.map(p => `${file}: ${p}`)); continue }
    if (`${read.content.osm}.json` !== file) problems.push(`${file}: osm: the file is named for ${file.replace(/\.json$/, '')}, its content for ${read.content.osm}`)
    out.push({ file, content: read.content })
  }
  if (problems.length > 0) throw new DemoContentError(problems)
  return out
}

export async function buildDemo(db: Db, input: DemoBuildInput): Promise<DemoBuildResult> {
  const now = input.now ?? new Date()
  const sharedDir = input.sharedDir ?? SHARED_DIR
  const seeded: Record<string, number> = {}
  const add = (counts: Record<string, number>) => {
    for (const [k, v] of Object.entries(counts)) seeded[k] = (seeded[k] ?? 0) + v
  }

  // 1. The shared files, which the importer's comuni come from.
  add(await seed(db, sharedDir))
  const manifest = JSON.parse(await readFile(join(input.extractDir, 'manifest.json'), 'utf8')) as { extracted: string }
  const known = await osmVocabulary(db, input.gazetteer, `${manifest.extracted}T00:00:00.000Z`)
  const keyOf = new Map(Object.entries(known.comuneByIstat).map(([istat, id]) => [id, `comune-${istat}`]))

  const read = await readExtract(input.extractDir)
  // Two places called alike are told apart before anything is read by name.
  const extract = { ...read, rows: tellNamesApart(read.rows, known) }
  // A feature read from two queries is the first one, as the importer takes it.
  const rowOf = new Map<string, OsmRow>()
  for (const row of extract.rows) if (!rowOf.has(row.osm)) rowOf.set(row.osm, row)

  // 2. The content, checked whole before any of it is written.
  const contents = await readContentDir(input.contentDir)
  const problems: string[] = []
  const toWrite: { file: string; content: ContentFile; place: DemoPlace; placeId: string; itinerary: DemoItinerary; row: OsmRow }[] = []
  const leftOut: DemoLeftOut[] = []
  const keys = new Map<string, string>(), names = new Map<string, string>()
  for (const { file, content } of contents) {
    const row = rowOf.get(content.osm)
    if (!row) { problems.push(`${file}: osm: no place ${content.osm} in the extract`); continue }
    const t = translateOsm(row, known)
    if (!t.ok) {
      for (const r of t.refusals) problems.push(`${file}: osm: the importer refuses ${content.osm} on ${r.field}: ${r.reason} (found: ${r.found})`)
      continue
    }
    const placeKey = keyOf.get(t.placeId)
    if (!placeKey) { problems.push(`${file}: osm: ${t.place.comune} has no gazetteer key`); continue }
    const composed = compose(t.place, placeKey, content)
    if (composed.kind === 'refused') { problems.push(...composed.problems.map(p => `${file}: ${p}`)); continue }
    if (composed.kind === 'left-out') {
      leftOut.push({ osm: content.osm, name: t.place.name, activity: t.place.activity, needs: composed.needs, file })
      continue
    }
    // The seed keys a route by its name, and pages by their key: each once.
    const it = composed.itinerary
    const sameKey = keys.get(it.key), sameName = names.get(it.name)
    if (sameKey) problems.push(`${file}: itinerary.key: ${it.key} is already ${sameKey}'s`)
    if (sameName) problems.push(`${file}: name: ${it.name} is already ${sameName}'s; the seed would take one for the other`)
    keys.set(it.key, file); names.set(it.name, file)
    toWrite.push({ file, content, place: t.place, placeId: t.placeId, itinerary: it, row })
  }
  if (problems.length > 0) throw new DemoContentError(problems)

  if (toWrite.length > 0) {
    const dir = await mkdtemp(join(tmpdir(), 'demo-content-'))
    try {
      await writeFile(join(dir, 'content.json'), JSON.stringify({ itineraries: toWrite.map(w => w.itinerary) }))
      // The gazetteer again, beside the content: the seed resolves a comune's key from the files it reads.
      add(await seed(db, [dir, sharedDir], { photos: input.photos ?? null, ...(input.photosDir ? { photosDir: input.photosDir } : {}) }))
    } finally {
      await rm(dir, { recursive: true, force: true })
    }
  }
  const ids = new Map<string, string>()
  for (const w of toWrite) {
    const held = await findItineraryByNameInPlace(db, w.itinerary.name, w.placeId)
    if (!held) throw new Error(`${w.file}: ${w.itinerary.name} was not seeded`)
    ids.set(w.content.osm, held.id)
    if (w.row.track && !CLIMBING.has(w.itinerary.activity)) {
      await saveTrack(db, held.id, w.row.track.map(([lat, lon]) => [lat, lon, null] as const), `osm:${w.content.osm}`)
      seeded.tracks = (seeded.tracks ?? 0) + 1
    }
  }

  // 3. Every other place, as the importer writes it.
  const withContent = new Set(contents.map(c => c.content.osm))
  const rest = extract.rows.filter(r => !withContent.has(r.osm) && (input.only === undefined || input.only.has(r.osm)))
  const measured = await importOsm(db, rest, known)
  for (const p of measured.waiting) {
    leftOut.push({ osm: p.osm, name: p.name, activity: p.activity, needs: p.needs, file: null })
  }

  // 4. The themes, from what was recorded.
  const themes = { itineraries: 0, themes: 0, flags: 0, reports: 0 }
  for (const w of toWrite) {
    const reports = w.itinerary.reports
    if (reports.length === 0) continue
    const id = ids.get(w.content.osm)!
    const model = replayedModel(reports.map((r, i) => ({ words: r.words, reading: w.content.readings?.[i] ?? undefined })))
    await regenerateSynthesis(db, id, w.itinerary.name, model, now)
    const saved = await synthesisFor(db, id)
    themes.itineraries++
    themes.reports += reports.length
    themes.themes += saved?.themes.length ?? 0
    themes.flags += saved?.flags.length ?? 0
  }

  return {
    withContent: toWrite.map(w => ({ osm: w.content.osm, name: w.itinerary.name, activity: w.itinerary.activity, reports: w.itinerary.reports.length })),
    measured, leftOut, themes, seeded,
    selection: input.only === undefined ? null
      : { chosen: input.only.size, notInExtract: [...input.only].filter(id => !rowOf.has(id)).sort() },
  }
}

function countBy<T>(items: readonly T[], key: (t: T) => string): [string, number][] {
  const m = new Map<string, number>()
  for (const i of items) m.set(key(i), (m.get(key(i)) ?? 0) + 1)
  return [...m].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
}

const EXAMPLES = 5

/** What the build did: the places built, by activity; those left out, and why; the themes read. */
export function demoReportOf(r: DemoBuildResult): string {
  const written = r.measured.written
  const lines: string[] = [
    `${r.withContent.length + written.length} places built: ${r.withContent.length} with written content, `
    + `${written.length} from OpenStreetMap alone; ${r.leftOut.length} left out.`,
    '', 'Built, by activity (with content / OpenStreetMap alone):',
  ]
  const acts = new Set([...r.withContent.map(p => p.activity), ...written.map(p => p.activity)])
  for (const a of [...acts].sort()) {
    lines.push(`  ${a}: ${r.withContent.filter(p => p.activity === a).length} / ${written.filter(p => p.activity === a).length}`)
  }

  if (r.leftOut.length > 0) {
    lines.push('', 'Left out, a required fact still unwritten (never filled in):')
    const written = r.leftOut.filter(p => p.file !== null)
    for (const p of written) lines.push(`  ${p.osm}, ${p.name} (${p.activity}): ${p.file} does not write ${p.needs.join(', ')}`)
    for (const [why, n] of countBy(r.leftOut.filter(p => p.file === null), p => `${p.activity}, no content file for ${p.needs.join(', ')}`)) {
      lines.push(`  ${n} × ${why}`)
    }
  }

  const m = r.measured
  if (m.skipped.length > 0) {
    lines.push('', `Skipped, one name in one comune taken once: ${m.skipped.length}`)
    for (const s of m.skipped.slice(0, EXAMPLES)) lines.push(`  ${s.osm}, ${s.name} (${s.comune}) — held as ${s.heldAs}`)
    if (m.skipped.length > EXAMPLES) lines.push(`  … and ${m.skipped.length - EXAMPLES} more`)
  }
  if (m.refused.length > 0) {
    lines.push('', `Refused by the importer: ${m.refused.length}`)
    for (const [why, n] of countBy(m.refused, x => `${x.field}: ${x.reason}`)) lines.push(`  ${n} × ${why}`)
  }

  if (r.selection) {
    const missing = r.selection.notInExtract
    lines.push('', `Selection: ${r.selection.chosen} places chosen; places with content are always in.`)
    if (missing.length > 0) {
      lines.push(`  ${missing.length} chosen places are not in the extract (chosen from another one?): `
        + missing.slice(0, EXAMPLES).join(', ') + (missing.length > EXAMPLES ? ', …' : ''))
    }
  }

  const t = r.themes
  lines.push('', `Themes read for ${t.itineraries} itineraries from ${t.reports} reports: ${t.themes} themes, ${t.flags} changes.`)
  lines.push(`Seeded: ${Object.entries(r.seeded).filter(([, n]) => n > 0).map(([k, n]) => `${n} ${k}`).join(', ')}.`)
  return lines.join('\n')
}
