import { readFile, readdir, stat } from 'node:fs/promises'
import { DEFAULT_SET, currentSet, databaseFile } from './brand.ts'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'
import type { Db } from '../db/open.ts'
import { insertWeatherStation } from '../db/weather-station.ts'
import { addToArea, findPlaceByName, insertPlace, placeWherever } from '../db/place.ts'
import {
  byId, findItineraryByName, insertItinerary, insertPart, partsOf, retireItinerary, setFacts, setGradeBounds,
  setParking,
} from '../db/itinerary.ts'
import { findAccountByEmail, insertAccount } from '../db/account.ts'
import { addAuthor, hasAuthors, setRevisedIfUnset } from '../db/credits.ts'
import { findWebcamByName, insertWebcam, insertWebcamReading } from '../db/webcam.ts'
import { importedReportId, insertImportedReport } from '../db/gita.ts'
import { imageSize } from '../domain/image-size.ts'
import { importedPhotosOf, insertImportedPhotos, setImportedPhotoSize, type NewImportedPhoto, type PhotoCredit } from '../db/gita-photo.ts'
import type { PhotoMime, PhotoStore } from '../app/photo-store.ts'
import { activityOf } from '../domain/activities/index.ts'
import { readGpx } from '../domain/track.ts'
import { hasTrack, saveTrack } from '../db/track.ts'
import {
  gradeBoundsOf, pitchCountMismatch, resolveFacts, resolveAccessFacts, withMissingFacts, type Part,
} from '../domain/facts.ts'
import type { Aspect } from '../domain/quantity.ts'

const HERE = dirname(fileURLToPath(import.meta.url))

/** Every Italian comune, built by `comuni/build.ts`. */
const GAZETTEER = 'places.json'

/**
 * The files every data set shares: the comuni gazetteer and the weather
 * stations. Neither holds a route, so neither belongs to an archive.
 */
export const SHARED_DIR = join(HERE, 'data')

export { DEFAULT_SET }

/**
 * The folders one named data set is seeded from: its own, under `sets/`, then
 * the shared one. A name that is not a folder there is refused by name, so a
 * mistyped `SEED_SET` stops the start rather than seeding the shared files alone.
 */
export async function seedDirs(set: string = DEFAULT_SET): Promise<string[]> {
  const dir = join(HERE, 'sets', set)
  const isDir = /^[a-z0-9_-]+$/.test(set) && await stat(dir).then(s => s.isDirectory(), () => false)
  if (!isDir) {
    const known = (await readdir(join(HERE, 'sets'))).sort().join(', ')
    throw new Error(`seed: no data set named ${JSON.stringify(set)} (known: ${known})`)
  }
  return [dir, SHARED_DIR]
}

interface SeedFile {
  places?: { key: string; name: string; kind: string; parent?: string
             lat?: number; lon?: number
             /** The named areas this place belongs to beyond its parent: a comune's valley. */
             areas?: string[] }[]
  itineraries?: {
    key: string; activity: string; place: string; name: string
    lat?: number; lon?: number; parkingLat?: number; parkingLon?: number
    aspect?: string; altMax?: number
    facts?: Record<string, unknown>
    sections?: Record<string, string>
    parts?: { group?: string; fields: Record<string, unknown> }[]
    /** Trip reports, unsigned: nobody filed them here. Invented, or a real one's day with its words summarised. */
    reports?: SeedReport[]
    /** A GPX file in the tracks folder: the way as the source archive offers it for download. */
    track?: string
  }[]
  /** Routes an earlier seed wrote and this one takes away, by name and comune. */
  retired?: { name: string; comune: string }[]
  webcams?: { name: string; lat: number; lon: number
              readings: { takenAt: string; snowAboveM: number }[] }[]
  /** Weather stations as their network publishes them, for the links under `Adesso`. */
  stations?: { network: string; code: string; name: string; altM: number; lat: number; lon: number }[]
  /** The people who wrote the pages' descriptions: invented, and unable to sign in. */
  authors?: { key: string; name: string }[]
  /** Each page's own credits, by its name: when it was last revised, and who wrote it. */
  credits?: { itinerary: string; revised?: string; authors: string[] }[]
}

/**
 * A seeded author's account takes no password: the stored value is not a hash
 * verifyPassword can read, so it answers false to every attempt. The address is
 * under .invalid, which no mail can reach and no person can register.
 */
const NO_PASSWORD = 'nessuna'
const authorEmail = (key: string) => `${key}@autori.invalid`
const DAY = /^\d{4}-\d{2}-\d{2}$/

/** A report as the seed files write it: its day, its words, and the photos it carries. */
interface SeedReport {
  observedAt: string
  words: string
  /** Files in the photos folder, each credited in its `credits.json`. At most six, as on a gita. */
  photos?: { file: string; caption?: string }[]
}

/** One entry of the photos folder's `credits.json`: what the photo's licence asks to show. */
interface SeedCredit { author?: unknown; licence?: unknown; licenceUrl?: unknown; url?: unknown }

export interface SeedOptions {
  /**
   * Where report photos' bytes go — the same store the server reads them
   * from. Without one the seed writes no photo at all: a row whose bytes are
   * nowhere would be a broken image on the page, not a photo.
   */
  readonly photos?: PhotoStore | null
  /** The folder the seed's photos and their `credits.json` are read from. */
  readonly photosDir?: string
  /** The folder the seed's GPX tracks are read from. */
  readonly tracksDir?: string
}

/** The most photos one report holds, the same six a gita may carry (migration 010). */
const MAX_PHOTOS = 6

/**
 * Loads the seed archive. Idempotent by natural key, so running it twice is
 * safe. Every itinerary is validated through the registry on the way in — the
 * same path the importer of project 5 will take. All SQL for this lives in the
 * repository functions from src/db/, not here: this file only reads JSON,
 * validates, and calls them — the shape project 5's importer should copy.
 *
 * `dirs` are the folders read, in order: by default the default set's (`DEFAULT_SET`) and
 * the shared one (`seedDirs`). A single folder is read alone.
 */
export async function seed(db: Db, dirs?: string | readonly string[], options: SeedOptions = {}) {
  const folders = dirs === undefined ? await seedDirs() : typeof dirs === 'string' ? [dirs] : dirs
  const counts = { places: 0, itineraries: 0, parts: 0, reports: 0, photos: 0, tracks: 0, webcams: 0, stations: 0, authors: 0, retired: 0, kept: 0 }
  const tracksDir = options.tracksDir ?? join(HERE, 'tracks')
  // A track is added once, to a route that has none: one somebody gave the
  // route since is theirs, and the seed does not write over it.
  const addTrack = async (itineraryId: string, name: string, file: string | undefined) => {
    if (file === undefined || await hasTrack(db, itineraryId)) return
    let points
    try {
      points = readGpx(await readFile(join(tracksDir, file), 'utf8'))
    } catch (err) {
      throw new Error(`seed: ${name}'s track ${file}: ${err instanceof Error ? err.message : String(err)}`)
    }
    await saveTrack(db, itineraryId, points, `seed:${file}`)
    counts.tracks++
  }
  const photos = options.photos
    ? { store: options.photos, dir: options.photosDir ?? join(HERE, 'photos'), credits: null as Record<string, SeedCredit> | null }
    : null
  // A route an archive already holds keeps everything it has, and gains what
  // the seed has learned since: a header fact it never recorded, its
  // pitches if it lists none, its parking if it has none. Seeding still only adds.
  const fillIn = async (
    itineraryId: string, activity: string, facts: Record<string, unknown>, parts: readonly Part[],
    parking: { lat: number; lon: number } | null = null,
  ) => {
    const row = await byId(db, itineraryId)
    if (!row) return
    if (parking && (row.parkingLat === null || row.parkingLon === null)) await setParking(db, itineraryId, parking)
    const schema = activityOf(activity)
    const held = await partsOf(db, itineraryId)
    const addParts = held.length === 0 && parts.length > 0
    const merged = withMissingFacts(row.facts, facts)
    if (!merged && !addParts) return
    const nowParts = addParts ? parts : held
    const nowFacts = merged ?? row.facts
    resolveFacts(schema, nowFacts, nowParts)
    const mismatch = pitchCountMismatch(nowFacts, nowParts)
    if (mismatch) throw new Error(`seed: ${row.name}: ${mismatch}`)
    if (merged) await setFacts(db, itineraryId, merged)
    if (addParts) {
      for (const part of parts) {
        await insertPart(db, { id: part.id, itineraryId, group: part.group, position: part.position, fields: part.fields })
        counts.parts++
      }
    }
    await setGradeBounds(db, itineraryId, gradeBoundsOf(schema, nowFacts, nowParts))
  }

  const addReports = async (itineraryId: string, name: string, reports: readonly SeedReport[]) => {
    const added = await seedReports(db, itineraryId, name, reports, photos)
    counts.reports += added.reports
    counts.photos += added.photos
  }
  const placeIds = new Map<string, string>()
  // Credits name pages, which any file may hold, so they are read with the
  // rest and applied once every page is in.
  const authors: { key: string; name: string }[] = []
  const credits: NonNullable<SeedFile['credits']> = []

  // Folder by folder, in the order given, and within one the comuni list goes
  // last. It fills in what the hand-written files left out — a comune's
  // position, the towns nobody climbs from — and never moves a place one of
  // them set by hand: the mockups measure their distances from those, and are
  // held to them.
  const files: { path: string; data: SeedFile }[] = []
  for (const dir of folders) {
    const names = (await readdir(dir)).filter(f => f.endsWith('.json'))
      .sort((a, b) => Number(a === GAZETTEER) - Number(b === GAZETTEER) || a.localeCompare(b))
    for (const name of names) {
      const path = join(dir, name)
      files.push({ path, data: JSON.parse(await readFile(path, 'utf8')) as SeedFile })
    }
  }

  await db.tx(async () => {
    // First, before anything is written: a retired route whose name a live
    // file reuses in the same comune must be gone before that file looks it up.
    for (const { data } of files) {
      for (const r of data.retired ?? []) {
        const outcome = await retireItinerary(db, r.name, r.comune)
        if (outcome === 'retired') counts.retired++
        if (outcome === 'kept') counts.kept++
      }
    }

    // Every file's places before any file's routes, so a route may name a
    // comune only the gazetteer declares, which is read last.
    for (const { data } of files) {
      for (const p of data.places ?? []) {
        const parentId = p.parent ? placeIds.get(p.parent) ?? null : null
        const existing = await findPlaceByName(db, p.name, p.kind, parentId)
        const id = existing?.id ?? crypto.randomUUID()
        if (!existing) {
          await insertPlace(db, {
            id, name: p.name, kind: p.kind, parentId,
            // Only a place you travel from needs one. See migration 008.
            lat: p.lat ?? null, lon: p.lon ?? null,
          })
          counts.places++
        } else if (p.lat !== undefined && p.lon !== undefined) {
          // The comuni list reaches places an earlier file declared bare.
          await placeWherever(db, id, p.lat, p.lon)
        }
        placeIds.set(p.key, id)
        for (const area of p.areas ?? []) {
          const areaId = placeIds.get(area)
          if (!areaId) throw new Error(`seed: ${p.key} names area ${area}, which no earlier place declares`)
          await addToArea(db, id, areaId)
        }
      }
    }

    for (const { path, data } of files) {
      for (const [index, it] of (data.itineraries ?? []).entries()) {
        const parts: Part[] = (it.parts ?? []).map((p, i) => ({
          id: crypto.randomUUID(), group: p.group ?? null, position: i + 1, fields: p.fields,
        }))
        const mismatch = pitchCountMismatch(it.facts ?? {}, parts)
        if (mismatch) throw new Error(`seed: ${it.name}: ${mismatch}`)

        const placeId = placeIds.get(it.place)
        if (placeId === undefined) {
          throw new Error(`seed: ${path}, itineraries[${index}] (${it.name}), place: `
            + `no file declares a place with key ${JSON.stringify(it.place)}`)
        }

        const existing = await findItineraryByName(db, it.name)
        if (existing) {
          // The route is already held, but its reports may not be: an archive
          // seeded before reports had words held verdicts instead, and
          // migration 020 dropped them. Each report is added once.
          await fillIn(existing.id, it.activity, it.facts ?? {}, parts,
            it.parkingLat !== undefined && it.parkingLon !== undefined ? { lat: it.parkingLat, lon: it.parkingLon } : null)
          await addReports(existing.id, it.name, it.reports ?? [])
          await addTrack(existing.id, it.name, it.track)
          continue
        }

        // Fails here, loudly, with the field named — not at render time.
        resolveFacts(activityOf(it.activity), it.facts ?? {}, parts)
        resolveAccessFacts(activityOf(it.activity), it.facts ?? {}, parts)

        const id = crypto.randomUUID()
        await insertItinerary(db, {
          id, activity: it.activity, placeId, name: it.name,
          lat: it.lat ?? null, lon: it.lon ?? null,
          parkingLat: it.parkingLat ?? null, parkingLon: it.parkingLon ?? null,
          aspect: (it.aspect ?? null) as Aspect | null, altMax: it.altMax ?? null,
          facts: it.facts ?? {}, sections: it.sections ?? {},
          created: new Date().toISOString(),
        })
        counts.itineraries++

        for (const part of parts) {
          await insertPart(db, {
            id: part.id, itineraryId: id, group: part.group,
            position: part.position, fields: part.fields,
          })
          counts.parts++
        }

        // After the parts, because a crag's range is derived from them: the
        // registry decides which field is a grade, and falesia declares none
        // outside its pitches.
        await setGradeBounds(db, id,
          gradeBoundsOf(activityOf(it.activity), it.facts ?? {}, parts))

        await addReports(id, it.name, it.reports ?? [])
        await addTrack(id, it.name, it.track)
      }

      authors.push(...data.authors ?? [])
      credits.push(...data.credits ?? [])

      for (const station of data.stations ?? []) {
        if (await insertWeatherStation(db, station)) counts.stations++
      }

      for (const cam of data.webcams ?? []) {
        const existing = await findWebcamByName(db, cam.name)
        if (existing) continue
        const id = crypto.randomUUID()
        await insertWebcam(db, { id, name: cam.name, lat: cam.lat, lon: cam.lon })
        counts.webcams++
        for (const r of cam.readings) {
          await insertWebcamReading(db, {
            id: crypto.randomUUID(), webcamId: id, takenAt: r.takenAt, snowAboveM: r.snowAboveM,
          })
        }
      }
    }

    const accountIds = new Map<string, string>()
    for (const a of authors) {
      const existing = await findAccountByEmail(db, authorEmail(a.key))
      const id = existing?.id ?? crypto.randomUUID()
      if (!existing) {
        await insertAccount(db, { id, email: authorEmail(a.key), passwordHash: NO_PASSWORD, displayName: a.name })
        counts.authors++
      }
      accountIds.set(a.key, id)
    }
    for (const c of credits) {
      const it = await findItineraryByName(db, c.itinerary)
      if (!it) throw new Error(`seed: credits name ${c.itinerary}, which no seed file holds`)
      if (c.revised !== undefined) {
        if (!DAY.test(c.revised)) throw new Error(`seed: ${c.itinerary} revised ${JSON.stringify(c.revised)}, not a day`)
        await setRevisedIfUnset(db, it.id, c.revised)
      }
      if (await hasAuthors(db, it.id)) continue
      for (const [position, key] of c.authors.entries()) {
        const accountId = accountIds.get(key)
        if (!accountId) throw new Error(`seed: ${c.itinerary} names author ${key}, whom no file declares`)
        await addAuthor(db, it.id, accountId, position)
      }
    }
  })

  return counts
}

interface SeedPhotos {
  readonly store: PhotoStore
  readonly dir: string
  credits: Record<string, SeedCredit> | null
}

/**
 * Loaded as the importer loads a report from another archive: unsigned, no
 * account behind it, nothing to withdraw. The day, the words and the photos,
 * and only what is not already held: a report held from before photos
 * existed gets its photos now, and a photo whose bytes went missing from the
 * store is written again. Returns how many reports and photos were added.
 */
async function seedReports(
  db: Db, itineraryId: string, name: string, reports: readonly SeedReport[],
  photos: SeedPhotos | null,
): Promise<{ reports: number; photos: number }> {
  const added = { reports: 0, photos: 0 }
  for (const r of reports) {
    const key = { itineraryId, observedAt: r.observedAt, words: r.words }
    let id = await importedReportId(db, key)
    if (id === null) {
      id = crypto.randomUUID()
      await insertImportedReport(db, { id, ...key })
      added.reports++
    }
    if (photos && r.photos && r.photos.length > 0) {
      added.photos += await seedPhotos(db, id, `${name}, report of ${r.observedAt}`, r.photos, photos)
    }
  }
  return added
}

/**
 * One report's photos, read with the importer's rule: a photo whose file is
 * not there, or whose licence does not say who took it, under what terms and
 * where the original is, is refused by name — never written with a blank to
 * be filled in later, because nobody downstream could tell it was blank.
 */
async function seedPhotos(
  db: Db, reportId: string, where: string,
  listed: readonly { file: string; caption?: string }[], photos: SeedPhotos,
): Promise<number> {
  const refuse = (field: string, reason: string, found: unknown): never => {
    throw new Error(`seed: ${where}, ${field}: ${reason} (found: ${JSON.stringify(found)})`)
  }
  if (listed.length > MAX_PHOTOS) refuse('photos', `at most ${MAX_PHOTOS} photos to a report`, listed.length)

  photos.credits ??= await readCredits(photos.dir)
  const held = new Map((await importedPhotosOf(db, reportId)).map(p => [p.position, p]))
  const fresh: NewImportedPhoto[] = []
  const bytesOf = new Map<string, Buffer>()

  for (const [position, p] of listed.entries()) {
    const field = `photos[${position + 1}]`
    const mime = mimeOf(p.file) ?? refuse(`${field}.file`, 'expected a .jpg or .png file', p.file)
    const credit = creditOf(photos.credits[p.file])
      ?? refuse(`${field}.file`, `expected an author, a licence and a url in ${join(photos.dir, 'credits.json')}`, p.file)
    if (p.caption !== undefined && (typeof p.caption !== 'string' || p.caption.trim() === '')) {
      refuse(`${field}.caption`, 'expected written words, or no caption at all', p.caption)
    }
    let bytes: Buffer
    try {
      bytes = await readFile(join(photos.dir, p.file))
    } catch {
      return refuse(`${field}.file`, `no such file in ${photos.dir}`, p.file)
    }

    const size = imageSize(bytes)
    const had = held.get(position)
    if (had) {
      // Held already; its bytes may not be, on a store that was emptied, and
      // a photo held from before sizes were kept gets its size now.
      if (!(await photos.store.get(had.id, had.mime))) await photos.store.put(had.id, had.mime, bytes)
      if (had.width === null && size) await setImportedPhotoSize(db, had.id, size)
      continue
    }
    const id = crypto.randomUUID()
    bytesOf.set(id, bytes)
    fresh.push({ id, position, caption: p.caption?.trim() ?? null, mime, credit,
                 width: size?.width ?? null, height: size?.height ?? null })
  }

  // Bytes first: a row is only ever written for a photo the store can serve.
  for (const p of fresh) await photos.store.put(p.id, p.mime, bytesOf.get(p.id)!)
  await insertImportedPhotos(db, reportId, fresh)
  return fresh.length
}

async function readCredits(dir: string): Promise<Record<string, SeedCredit>> {
  const file = join(dir, 'credits.json')
  try {
    return JSON.parse(await readFile(file, 'utf8')) as Record<string, SeedCredit>
  } catch (e) {
    throw new Error(`seed: report photos need their credits, and ${file} could not be read: ${(e as Error).message}`)
  }
}

const text = (v: unknown): string | null => typeof v === 'string' && v.trim() !== '' ? v.trim() : null

function creditOf(c: SeedCredit | undefined): PhotoCredit | null {
  if (!c) return null
  const author = text(c.author), licence = text(c.licence), source = text(c.url)
  if (author === null || licence === null || source === null) return null
  return { author, licence, licenceUrl: text(c.licenceUrl), source }
}

function mimeOf(file: string): PhotoMime | null {
  const ext = file.toLowerCase().split('.').pop()
  return ext === 'jpg' || ext === 'jpeg' ? 'image/jpeg' : ext === 'png' ? 'image/png' : null
}

if (import.meta.filename === process.argv[1]) {
  const { openDb } = await import('../db/open.ts')
  const { migrate } = await import('../../db/migrate.ts')
  const { filesystemPhotoStore } = await import('../app/photo-store.ts')
  // Resolved before the database is opened: an unknown set changes nothing.
  const dirs = await seedDirs(currentSet())
  const db = openDb(databaseFile())
  await migrate(db)
  // The same folder the server serves photos from: see UPLOADS_DIR in server.ts.
  const uploads = process.env.UPLOADS_DIR ?? join(HERE, '..', '..', 'uploads')
  console.log(await seed(db, dirs, { photos: filesystemPhotoStore(uploads) }))
  await db.close()
}
