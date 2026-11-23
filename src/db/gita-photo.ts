import type { Db } from './open.ts'

export type PhotoMime = 'image/jpeg' | 'image/png'

export interface NewPhoto {
  readonly id: string
  readonly position: number
  readonly caption: string | null
  readonly mime: PhotoMime
  /** As shown, read from the bytes (`imageSize`); null when they could not be read, or for a photo held from before. */
  readonly width?: number | null
  readonly height?: number | null
}

/**
 * Who took a photo that came with an imported report, and on what terms: what
 * its licence asks to be shown beside it. A photo filed here has none — its
 * author is the person who filed the gita.
 */
export interface PhotoCredit {
  readonly author: string
  readonly licence: string
  readonly licenceUrl: string | null
  readonly source: string
}

export interface PhotoRow extends NewPhoto {
  /** The report it belongs to: a gita's id, or an imported report's. */
  readonly gitaId: string
  /** Who filed the report; null for an imported one, which nobody here filed. */
  readonly authorName: string | null
  readonly observedAt: string
  /** Set only on an imported report's photo. */
  readonly credit: PhotoCredit | null
}

interface RawPhoto {
  id: string; position: number; caption: string | null; mime: PhotoMime
  width: number | null; height: number | null
  gita_id: string; display_name: string | null; observed_at: string
  author: string | null; licence: string | null; licence_url: string | null; source: string | null
}

function toRow(r: RawPhoto): PhotoRow {
  return {
    id: r.id, position: r.position, caption: r.caption, mime: r.mime,
    width: r.width, height: r.height,
    gitaId: r.gita_id, authorName: r.display_name, observedAt: r.observed_at,
    credit: r.author !== null && r.licence !== null && r.source !== null
      ? { author: r.author, licence: r.licence, licenceUrl: r.licence_url, source: r.source }
      : null,
  }
}

/** Written from inside the same transaction `fileGita` opens — never on its own. */
export async function insertPhotos(
  db: Db, gitaId: string, photos: readonly NewPhoto[],
): Promise<void> {
  for (const p of photos) {
    await db.run(
      `insert into gita_photo (id, gita_id, position, caption, mime, width, height)
       values (?, ?, ?, ?, ?, ?, ?)`,
      [p.id, gitaId, p.position, p.caption, p.mime, p.width ?? null, p.height ?? null])
  }
}

/** A photo that came with an imported report, credited as its licence asks. */
export interface NewImportedPhoto extends NewPhoto {
  readonly credit: PhotoCredit
}

/** Written beside the imported report it belongs to — by the seed, or an import. */
export async function insertImportedPhotos(
  db: Db, reportId: string, photos: readonly NewImportedPhoto[],
): Promise<void> {
  for (const p of photos) {
    await db.run(
      `insert into imported_report_photo
         (id, imported_report_id, position, caption, mime, width, height,
          author, licence, licence_url, source)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [p.id, reportId, p.position, p.caption, p.mime, p.width ?? null, p.height ?? null,
       p.credit.author, p.credit.licence, p.credit.licenceUrl, p.credit.source])
  }
}

/** An imported report's photos already held, by position: what keeps the seed from adding them twice. */
export async function importedPhotosOf(
  db: Db, reportId: string,
): Promise<{ id: string; position: number; mime: PhotoMime; width: number | null }[]> {
  return db.all(
    `select id, position, mime, width from imported_report_photo
     where imported_report_id = ? order by position`, [reportId])
}

/** Fills in the size of an imported photo held from before sizes were kept (migration 025). */
export async function setImportedPhotoSize(
  db: Db, id: string, size: { width: number; height: number },
): Promise<void> {
  await db.run(`update imported_report_photo set width = ?, height = ? where id = ?`,
    [size.width, size.height, id])
}

/**
 * Every photo standing against an itinerary, newest report first then
 * position: a filed gita's, joined through gita and excluding retracted
 * ones, and an imported report's beside them — ordered exactly as `giteFor`
 * in `src/db/gita.ts` orders the reports themselves, an imported report
 * counting as filed the evening of its day.
 */
export async function photosFor(db: Db, itineraryId: string): Promise<PhotoRow[]> {
  const rows = await db.all<RawPhoto>(
    `select * from (
       select p.id, p.position, p.caption, p.mime, p.width, p.height, g.id as gita_id, a.display_name,
              g.observed_at, g.filed_at,
              null as author, null as licence, null as licence_url, null as source
       from gita_photo p
       join gita g on g.id = p.gita_id
       join account a on a.id = g.account_id
       where g.itinerary_id = ?
         and not exists (select 1 from retraction r where r.gita_id = g.id)
       union all
       select p.id, p.position, p.caption, p.mime, p.width, p.height, ir.id, null,
              ir.observed_at, ir.observed_at || 'T18:00:00.000Z',
              p.author, p.licence, p.licence_url, p.source
       from imported_report_photo p
       join imported_report ir on ir.id = p.imported_report_id
       where ir.itinerary_id = ?
     )
     order by observed_at desc, filed_at desc, gita_id, position`, [itineraryId, itineraryId])
  return rows.map(toRow)
}

/**
 * Whether a photo still stands: a filed one whose gita has not been
 * retracted, or an imported report's, which nothing withdraws.
 */
export async function standingPhoto(db: Db, id: string): Promise<boolean> {
  const row = await db.get(
    `select 1 from gita_photo p
     join gita g on g.id = p.gita_id
     where p.id = ?
       and not exists (select 1 from retraction r where r.gita_id = g.id)
     union all
     select 1 from imported_report_photo where id = ?`, [id, id])
  return row !== undefined
}
