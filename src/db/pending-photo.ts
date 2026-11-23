import type { Db } from './open.ts'
import type { PhotoMime } from './gita-photo.ts'

export interface NewPendingPhoto {
  readonly id: string
  readonly accountId: string
  readonly mime: PhotoMime
  readonly created: string
  readonly expires: string
}

export interface PendingPhotoRow {
  readonly id: string
  readonly mime: PhotoMime
}

export async function insertPendingPhoto(db: Db, p: NewPendingPhoto): Promise<void> {
  await db.run(
    `insert into pending_photo (id, account_id, mime, created, expires) values (?, ?, ?, ?, ?)`,
    [p.id, p.accountId, p.mime, p.created, p.expires])
}

/**
 * Every one of `ids` that is still this account's and not yet expired, in the
 * order `ids` names them — screen 2's render and a failed publish's
 * re-render both key their figures off that order, not off whatever order a
 * database happens to return rows in.
 */
export async function livePendingPhotos(
  db: Db, accountId: string, ids: readonly string[], nowIso: string,
): Promise<PendingPhotoRow[]> {
  if (ids.length === 0) return []

  const placeholders = ids.map(() => '?').join(', ')
  const rows = await db.all<{ id: string; mime: PhotoMime }>(
    `select id, mime from pending_photo
     where account_id = ? and expires > ? and id in (${placeholders})`,
    [accountId, nowIso, ...ids])

  const byId = new Map(rows.map(r => [r.id, { id: r.id, mime: r.mime }]))
  return ids.flatMap(id => { const row = byId.get(id); return row ? [row] : [] })
}

/**
 * This account's own expired rows — read before they are deleted, since a
 * deleted row can no longer say which file on disk belonged to it. The
 * opportunistic sweep in `src/app/gite.ts` is this function's one caller.
 */
export async function expiredPendingPhotos(
  db: Db, accountId: string, nowIso: string,
): Promise<PendingPhotoRow[]> {
  const rows = await db.all<{ id: string; mime: PhotoMime }>(
    `select id, mime from pending_photo where account_id = ? and expires <= ?`,
    [accountId, nowIso])
  return rows.map(r => ({ id: r.id, mime: r.mime }))
}

/**
 * Written for two callers: the opportunistic sweep, and promotion inside
 * `fileGita`'s own transaction. Deleting an id that is not there — already
 * promoted, or never existed — is a silent no-op on purpose: "already
 * promoted" and "never existed" are meant to be the same outcome.
 *
 * Scoped to `accountId` in its own signature, not left to caller discipline:
 * both callers already pre-scope their id lists through an account-scoped
 * read first, but this is the one lookup in this module whose own shape
 * would otherwise let an id alone reach across accounts.
 */
export async function deletePendingPhotos(
  db: Db, accountId: string, ids: readonly string[],
): Promise<void> {
  if (ids.length === 0) return
  const placeholders = ids.map(() => '?').join(', ')
  await db.run(
    `delete from pending_photo where account_id = ? and id in (${placeholders})`,
    [accountId, ...ids])
}
