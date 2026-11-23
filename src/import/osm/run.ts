import { readFile } from 'node:fs/promises'
import type { Db } from '../../db/open.ts'
import { findPlaceByName } from '../../db/place.ts'
import { findItineraryByNameInPlace, insertItinerary, insertPart, setGradeBounds } from '../../db/itinerary.ts'
import { saveTrack } from '../../db/track.ts'
import { activityOf } from '../../domain/activities/index.ts'
import { gradeBoundsOf, type Part } from '../../domain/facts.ts'
import type { OsmRow } from './source.ts'
import { osmItineraryId } from './stable-id.ts'
import {
  translateOsm, type BoulderMember, type DemoPlace, type OsmRefusal, type OsmTranslated, type OsmVocabulary, type WrittenParts,
} from './translate.ts'

/** A place already in the database under the same name and comune. Named, as the other importer names its skips. */
export interface OsmPresent {
  readonly osm: string
  readonly name: string
  readonly comune: string
  /** The itinerary already held, or, where an earlier feature of this run was taken, its OpenStreetMap id. */
  readonly heldAs: string
}

export interface OsmImportResult {
  /** Every place taken — written now or waiting on Phase 3 — with what it still needs. */
  readonly places: readonly DemoPlace[]
  /** The places written into the database, by OpenStreetMap id. */
  readonly written: readonly DemoPlace[]
  /** Taken, not written: a required fact is still to be written (`needs`). */
  readonly waiting: readonly DemoPlace[]
  readonly skipped: readonly OsmPresent[]
  readonly refused: readonly OsmRefusal[]
  /** Boulders listed under the area OpenStreetMap puts them in, by the area's id. */
  readonly grouped: readonly { readonly osm: string; readonly area: string }[]
}

/** The regions the demo covers, by the gazetteer's keys. */
const REGIONS = new Set(['regione-01', 'regione-02'])

interface GazetteerPlace { key: string; name: string; kind: string; parent?: string }

/**
 * The comuni of Piemonte and Valle d'Aosta this database holds, by ISTAT code
 * and by name. The gazetteer (src/seed/data/places.json) says which comune an
 * ISTAT code is and in which province; the database says what id it has. A
 * comune the gazetteer lists and the database lacks is left out, and the
 * translator refuses a feature in it by name rather than adding the place.
 */
export async function osmVocabulary(db: Db, gazetteerPath: string, created: string): Promise<OsmVocabulary> {
  const places = (JSON.parse(await readFile(gazetteerPath, 'utf8')) as { places: GazetteerPlace[] }).places
  const byKey = new Map(places.map(p => [p.key, p]))
  const ids = new Map<string, string | null>()
  const idOf = async (key: string): Promise<string | null> => {
    if (ids.has(key)) return ids.get(key)!
    const p = byKey.get(key)
    let id: string | null = null
    if (p) {
      const parent = p.parent ? await idOf(p.parent) : undefined
      if (parent !== null) id = (await findPlaceByName(db, p.name, p.kind, parent))?.id ?? null
    }
    ids.set(key, id)
    return id
  }

  const comuneByIstat: Record<string, string> = {}
  const comuneByName: Record<string, string | null> = {}
  const provinces = new Set<string>()
  for (const p of places) {
    if (p.kind !== 'comune' || !p.parent) continue
    if (!REGIONS.has(byKey.get(p.parent)?.parent ?? '')) continue
    provinces.add(p.key.replace(/^comune-/, '').slice(0, 3))
    const id = await idOf(p.key)
    if (id === null) continue
    comuneByIstat[p.key.replace(/^comune-/, '')] = id
    comuneByName[p.name] = p.name in comuneByName ? null : id
  }
  return { comuneByIstat, comuneByName, provinces, created }
}

const CLIMBING = new Set(['falesia', 'multipitch', 'bouldering'])

/** One complete place, written whole or not at all. */
async function write(db: Db, t: Extract<OsmTranslated, { ok: true }>): Promise<void> {
  const it = t.itinerary!
  await db.tx(async () => {
    // The same on every build, so the page's address survives a rebuild.
    const id = osmItineraryId(t.place.osm)
    await insertItinerary(db, { id, ...it })
    const parts: Part[] = t.parts.map(p => ({ ...p, id: crypto.randomUUID() }))
    for (const part of parts) {
      await insertPart(db, { id: part.id, itineraryId: id, group: part.group, position: part.position, fields: part.fields })
    }
    await setGradeBounds(db, id, gradeBoundsOf(activityOf(it.activity), it.facts, parts))
    // A climbing feature's line is its wall or its pitches, not a way to walk;
    // a route's is the way.
    if (t.place.track && !CLIMBING.has(it.activity)) {
      await saveTrack(db, id, t.place.track.map(([lat, lon]) => [lat, lon, null] as const), `osm:${t.place.osm}`)
    }
  })
}

/**
 * Every feature of an extract, taken or refused by name.
 *
 * A feature appears once: one read from two queries (a cliff that is also a
 * via ferrata) is taken the first time and refused the second. A place already
 * held under the same name in the same comune — the segments of one via
 * ferrata, a second run — is skipped and named, never written twice and never
 * written onto.
 */
export async function importOsm(
  db: Db, rows: readonly OsmRow[], known: OsmVocabulary,
  written: Readonly<Record<string, WrittenParts>> = {},
): Promise<OsmImportResult> {
  const seen = new Map<string, string>()
  const taken = new Map<string, string>()
  const places: DemoPlace[] = []
  const done: DemoPlace[] = []
  const waiting: DemoPlace[] = []
  const skipped: OsmPresent[] = []
  const refused: OsmRefusal[] = []

  // First every feature is read, so a boulder read before its area still
  // reaches it: the boulders are gathered under their area's id.
  const read: { row: OsmRow; t: OsmTranslated }[] = []
  const members = new Map<string, BoulderMember[]>()
  for (const row of rows) {
    const first = seen.get(row.osm)
    if (first !== undefined) {
      refused.push({ osm: row.osm, name: null, field: 'source', reason: `already read from ${first}`, found: row.source })
      continue
    }
    seen.set(row.osm, row.source)
    const t = translateOsm(row, known, written[row.osm])
    if (!t.ok && 'memberOf' in t) {
      members.set(t.memberOf, [...(members.get(t.memberOf) ?? []), t.member])
      continue
    }
    read.push({ row, t })
  }

  for (const { row, t: first } of read) {
    let t = first
    if (!t.ok) { refused.push(...t.refusals); continue }
    const boulders = members.get(row.osm)
    if (boulders) t = { ...t, place: { ...t.place, boulders } }

    // Two features of one name in one comune are one place (the ways of one
    // via ferrata), whatever their activity, as the database keys them: the
    // first is taken, the others named here.
    const key = `${t.place.name}|${t.placeId}`
    const earlier = taken.get(key)
    if (earlier !== undefined) {
      skipped.push({ osm: row.osm, name: t.place.name, comune: t.place.comune, heldAs: earlier })
      continue
    }
    taken.set(key, row.osm)
    if (t.itinerary === null) { places.push(t.place); waiting.push(t.place); continue }

    const existing = await findItineraryByNameInPlace(db, t.itinerary.name, t.itinerary.placeId)
    if (existing) {
      // Held from an earlier run: still a place Phase 3 writes for.
      places.push(t.place)
      skipped.push({ osm: row.osm, name: t.place.name, comune: t.place.comune, heldAs: existing.id })
      continue
    }
    try {
      await write(db, t)
      places.push(t.place)
      done.push(t.place)
    } catch (err) {
      refused.push({ osm: row.osm, name: t.place.name, field: 'name',
        reason: `the archive refused this place: ${(err as Error).message}`, found: t.place.name })
    }
  }

  // A boulder whose area was not taken — refused, or one name in one comune
  // taken under another feature — is refused with the area named.
  const listed = new Set(places.filter(p => p.boulders).map(p => p.osm))
  const grouped: { osm: string; area: string }[] = []
  for (const [area, bs] of members) {
    for (const b of bs) {
      if (listed.has(area)) grouped.push({ osm: b.osm, area })
      else refused.push({ osm: b.osm, name: b.name, field: 'area',
        reason: 'the area OpenStreetMap puts this boulder in was not taken', found: area })
    }
  }

  return { places, written: done, waiting, skipped, refused, grouped }
}
