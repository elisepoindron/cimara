import type { Db } from './open.ts'

export interface SessionRow {
  readonly id: string
  readonly accountId: string
  readonly expires: string
}

export interface NewSession {
  readonly id: string
  readonly accountId: string
  readonly created: string
  readonly expires: string
}

export async function insertSession(db: Db, s: NewSession): Promise<void> {
  await db.run(`insert into session (id, account_id, created, expires) values (?, ?, ?, ?)`,
               [s.id, s.accountId, s.created, s.expires])
}

/** Null for unknown and for expired alike — both mean "this authenticates nobody". */
export async function findLiveSession(
  db: Db, id: string, nowIso: string,
): Promise<SessionRow | null> {
  const row = await db.get<{ id: string; account_id: string; expires: string }>(
    `select id, account_id, expires from session where id = ? and expires > ?`, [id, nowIso])

  return row ? { id: row.id, accountId: row.account_id, expires: row.expires } : null
}

export async function deleteSession(db: Db, id: string): Promise<void> {
  await db.run(`delete from session where id = ?`, [id])
}

export async function deleteExpiredSessions(db: Db, nowIso: string): Promise<void> {
  await db.run(`delete from session where expires <= ?`, [nowIso])
}
