import type { Db } from '../db/open.ts'
import { imageSize } from '../domain/image-size.ts'
import { byId } from '../db/itinerary.ts'
import { fileGita, findGita, retractGita } from '../db/gita.ts'
import { WORDS_MAX, CAPTION_MAX } from '../render/gita-form.ts'
import { insertPendingPhoto, livePendingPhotos, expiredPendingPhotos, deletePendingPhotos } from '../db/pending-photo.ts'
import type { PhotoStore, PhotoMime } from './photo-store.ts'
import type { UploadedFile } from './http.ts'
import type { NewPhoto } from '../db/gita-photo.ts'

export type FileResult =
  | { readonly ok: true; readonly gitaId: string }
  | { readonly ok: false; readonly problems: readonly string[] }

export interface FormInput {
  readonly itineraryId: string
  readonly accountId: string
  /** The posted body, exactly as it arrived: strings, keyed by field name. */
  readonly fields: ReadonlyMap<string, string>
}

/** The calendar day an instant falls in. Days are compared as days, never as instants. */
export const dayOf = (at: Date): string => at.toISOString().slice(0, 10)

/**
 * A real calendar day, as `<input type="date">` posts it. The round-trip is
 * what rejects '2026-02-31', which the pattern alone accepts and `Date` then
 * silently rolls forward into March.
 */
function isDay(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const at = new Date(`${value}T00:00:00.000Z`)
  return !Number.isNaN(at.getTime()) && dayOf(at) === value
}

/** Generous for a phone photo; small enough that six of them stay well under MAX_PHOTO_BODY_BYTES. */
export const PHOTO_MAX_BYTES = 8_000_000

const JPEG_MAGIC = Buffer.from([0xff, 0xd8, 0xff])
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47])

/** Sniffed from the bytes, never trusted from the client's declared content-type. */
export function sniff(bytes: Buffer): PhotoMime | null {
  if (bytes.subarray(0, 3).equals(JPEG_MAGIC)) return 'image/jpeg'
  if (bytes.subarray(0, 4).equals(PNG_MAGIC)) return 'image/png'
  return null
}

/**
 * Caps how many files `POST /gita/foto` accepts in one request — not a count
 * of slots in a form any more; the composer has none. Six, still: a gita can
 * carry at most that many photos, the bound
 * `db/migrations/010_gita_photo.sql`'s `check(position between 0 and 5)`
 * holds at the row level.
 */
export const PHOTOS_MAX = 6

const PENDING_PHOTO_HOURS = 24

/**
 * Generous for "pick photos, then fill in the rest of the report before you
 * lose your connection"; short enough that abandoned uploads do not
 * accumulate for long.
 */
function expiresAfter(now: Date): string {
  return new Date(now.getTime() + PENDING_PHOTO_HOURS * 60 * 60 * 1000).toISOString()
}

export type UploadResult =
  | { readonly ok: true; readonly ids: readonly string[] }
  | { readonly ok: false; readonly problems: readonly string[] }

/**
 * Opportunistic, not scheduled: every upload pays a small, bounded cost to
 * clear this account's own leftovers from a previous abandoned attempt — the
 * same "no background job" shape `session` already lives with.
 */
export async function sweepExpiredPendingPhotos(
  db: Db, pendingPhotos: PhotoStore, accountId: string, now: Date,
): Promise<void> {
  const expired = await expiredPendingPhotos(db, accountId, now.toISOString())
  for (const p of expired) await pendingPhotos.remove(p.id, p.mime)
  await deletePendingPhotos(db, accountId, expired.map(p => p.id))
}

/**
 * Every file posted under the one repeated `foto` field, sniffed and capped
 * exactly as filing itself always capped six fixed slots — refused by
 * position in this batch, all-or-nothing. What survives is written to
 * `pendingPhotos` and recorded with a 24-hour expiry, the same lazy-expiry
 * discipline `session` already uses.
 */
export async function uploadPendingPhotos(
  db: Db, pendingPhotos: PhotoStore, accountId: string,
  files: readonly UploadedFile[], now: Date,
): Promise<UploadResult> {
  const posted = files.filter(f => f.field === 'foto' && f.filename.trim() !== '')
  const problems: string[] = []

  if (posted.length > PHOTOS_MAX) {
    problems.push(`Puoi caricare al massimo ${PHOTOS_MAX} foto per volta.`)
  }

  const sniffed = posted.map((f, i) => {
    const mime = sniff(f.bytes)
    if (!mime) { problems.push(`Foto ${i + 1}: solo JPEG o PNG.`); return null }
    if (f.bytes.length > PHOTO_MAX_BYTES) {
      problems.push(`Foto ${i + 1}: il file è troppo grande.`); return null
    }
    return { bytes: f.bytes, mime }
  })

  if (problems.length) return { ok: false, problems }

  const expires = expiresAfter(now)
  const ids: string[] = []
  for (const s of sniffed) {
    // Every entry is non-null here — the check above already returned if any
    // were, so a null surviving to this point would mean this function wrote
    // a photo it had just refused, which it never does.
    const { bytes, mime } = s!
    const id = crypto.randomUUID()
    await pendingPhotos.put(id, mime, bytes)
    await insertPendingPhoto(db, { id, accountId, mime, created: now.toISOString(), expires })
    ids.push(id)
  }

  return { ok: true, ids }
}

/**
 * One filled-in composer, checked against the activity's own registry and
 * against the three rules no registry states, then filed.
 *
 * Every problem is collected in one pass and returned together, the way
 * `resolveFacts` does: one attempt, every problem. Nothing at all is written
 * unless all of them are absent.
 */
export async function fileFromForm(
  db: Db, photos: PhotoStore, pendingPhotos: PhotoStore, input: FormInput, now: Date,
): Promise<FileResult> {
  const itinerary = await byId(db, input.itineraryId)
  if (!itinerary) return { ok: false, problems: ['Questo itinerario non c’è.'] }

  const problems: string[] = []

  const day = (input.fields.get('quando') ?? '').trim()
  if (!isDay(day)) {
    problems.push('Il giorno della gita non è una data valida.')
  } else if (day > dayOf(now)) {
    // You cannot report a climb you have not done. Whole days, so a gita filed
    // the evening of the day it happened is not "in the future" by an hour.
    problems.push('Il giorno della gita è nel futuro.')
  }

  // Counted on the raw value, in code units, because that is what the browser
  // counted against the textarea's `maxlength` — a courtesy to an honest
  // browser, never a control. This is the control. What is stored is trimmed:
  // no archive wants a paragraph that opens with four blank lines.
  const words = input.fields.get('parole') ?? ''
  if (words.trim() === '') {
    problems.push('Scrivi com’è andata.')
  } else if (words.length > WORDS_MAX) {
    problems.push(`Il racconto supera i ${WORDS_MAX} caratteri.`)
  }

  const fotoIds = (input.fields.get('foto_ids') ?? '').split(',').map(s => s.trim()).filter(s => s !== '')
  // Numbered by position in the full picked batch — the same "Foto N" a
  // climber who picked several photos in one dialog can still map back to
  // what screen 2 showed them. An unchecked photo's `incl_<id>` field never
  // arrived, so it is never looked up at all: it can never be the reason a
  // publish is refused.
  const included = fotoIds
    .map((id, i) => ({ id, number: i + 1 }))
    .filter(({ id }) => input.fields.has(`incl_${id}`))

  // `readPhotos`, before this, could never carry more than PHOTOS_MAX photos
  // or the same id twice — it minted one fresh id per one of six named slots.
  // A client-supplied `foto_ids` list has neither guarantee, and both would
  // otherwise surface as a raw, uncaught database error: the row-level
  // `check(position between 0 and 5)` for a batch that is too big, and the
  // `gita_photo.id` primary key for one repeated.
  if (included.length > PHOTOS_MAX) {
    problems.push(`Puoi includere al massimo ${PHOTOS_MAX} foto.`)
  }

  const seen = new Set<string>()
  const deduped: typeof included = []
  for (const item of included) {
    if (seen.has(item.id)) { problems.push(`Foto ${item.number}: ripetuta.`); continue }
    seen.add(item.id)
    deduped.push(item)
  }

  const live = deduped.length
    ? await livePendingPhotos(db, input.accountId, deduped.map(x => x.id), now.toISOString())
    : []
  const liveById = new Map(live.map(p => [p.id, p]))

  const toPromote: NewPhoto[] = []
  const numberById = new Map<string, number>()
  for (const { id, number } of deduped) {
    const row = liveById.get(id)
    if (!row) { problems.push(`Foto ${number}: la sessione di caricamento è scaduta.`); continue }

    const typedCaption = (input.fields.get(`didascalia_${id}`) ?? '').trim()
    if (typedCaption.length > CAPTION_MAX) { problems.push(`Didascalia ${number}: troppo lunga.`); continue }

    numberById.set(id, number)
    toPromote.push({
      id, mime: row.mime, position: toPromote.length,
      caption: typedCaption === '' ? null : typedCaption,
    })
  }

  if (problems.length) return { ok: false, problems }

  // Filesystem operations, not reversible by a database rollback — the same
  // "bytes before the transaction" discipline the shipped feature always
  // used, just moved earlier: the bytes already left `pendingPhotos` before
  // the gita they belong to is known to exist.
  //
  // Every photo's bytes are read before any of them move. Moving each photo
  // as soon as its own bytes were read would let an earlier photo in the
  // batch be promoted — removed from `pendingPhotos`, written into `photos`
  // — and only then discover a later photo in the same batch cannot be read:
  // the whole publish is refused either way, but the earlier photo's
  // `pending_photo` row would already be gone, unrecoverable until it
  // expires on its own, with nothing to retry.
  const loaded: { readonly p: NewPhoto; readonly bytes: Buffer }[] = []
  for (const p of toPromote) {
    const bytes = await pendingPhotos.get(p.id, p.mime)
    // The row was live moments ago, in the batch query above — this only
    // fires on a genuine race (a concurrent duplicate submission already
    // moved and removed these same bytes). Refusing beats a crash, even
    // though a photo promoted by that other request stays promoted.
    if (bytes === null) {
      return { ok: false, problems: [`Foto ${numberById.get(p.id)}: la sessione di caricamento è scaduta.`] }
    }
    loaded.push({ p, bytes })
  }
  for (const { p, bytes } of loaded) {
    await photos.put(p.id, p.mime, bytes)
    await pendingPhotos.remove(p.id, p.mime)
  }

  // Each photo's shape, read from its bytes, so the photos page can lay it out
  // before it loads. A size that cannot be read is null, never a guess.
  const sized: NewPhoto[] = loaded.map(({ p, bytes }) => {
    const size = imageSize(bytes)
    return { ...p, width: size?.width ?? null, height: size?.height ?? null }
  })

  const gitaId = crypto.randomUUID()
  await fileGita(db, {
    id: gitaId,
    itineraryId: itinerary.id,
    accountId: input.accountId,
    observedAt: day,
    filedAt: now.toISOString(),
    words: words.trim(),
  }, sized, sized.map(p => p.id))

  return { ok: true, gitaId }
}

export interface RetractResult {
  readonly ok: boolean
  readonly problems?: readonly string[]
}

/**
 * Withdrawing a report. The author check is here, on the server, because
 * hiding the control is presentation and refusing the request is the control —
 * a page is not what decides who may do this.
 *
 * Withdrawing twice answers ok and writes nothing the second time: the button
 * is a button, and clicking it again means the same thing it meant the first
 * time. A gita that does not exist is refused rather than quietly accepted, so
 * a wrong id cannot look like a successful withdrawal.
 */
export async function retract(
  db: Db, gitaId: string, accountId: string, now: Date,
): Promise<RetractResult> {
  const gita = await findGita(db, gitaId)
  if (!gita) return { ok: false, problems: ['Questa relazione non c’è.'] }
  if (gita.accountId !== accountId) {
    return { ok: false, problems: ['Questa relazione non è tua.'] }
  }

  await retractGita(db, gitaId, now.toISOString())
  return { ok: true }
}
