import type { Db } from './open.ts'

export interface AccountRow {
  readonly id: string
  readonly email: string
  readonly passwordHash: string
  readonly displayName: string
}

export interface NewAccount {
  readonly id: string
  readonly email: string
  readonly passwordHash: string
  readonly displayName: string
}

/**
 * The public demonstration's one account, shared by every visitor: no one
 * signs up there, and nobody's address is kept. An `.invalid` address, which
 * can never be anybody's.
 */
export const VISITOR_EMAIL = 'visitatore@demo.invalid'

/**
 * An address is not case-sensitive, and the unique index compares the strings it
 * was given — so normalising here is what actually stops Elise@ and elise@
 * becoming two accounts.
 */
const normalise = (email: string) => email.trim().toLowerCase()

interface RawAccount {
  id: string; email: string; password_hash: string; display_name: string
}

function toRow(r: RawAccount): AccountRow {
  return {
    id: r.id, email: r.email,
    passwordHash: r.password_hash, displayName: r.display_name,
  }
}

export async function findAccountByEmail(db: Db, email: string): Promise<AccountRow | null> {
  const row = await db.get<RawAccount>(
    `select id, email, password_hash, display_name from account where email = ?`,
    [normalise(email)])

  return row ? toRow(row) : null
}

/** The same shape as `findAccountByEmail`, keyed on the primary key — for
 * resolving an account from a session's `account_id`. */
export async function findAccountById(db: Db, id: string): Promise<AccountRow | null> {
  const row = await db.get<RawAccount>(
    `select id, email, password_hash, display_name from account where id = ?`, [id])

  return row ? toRow(row) : null
}

export async function insertAccount(db: Db, a: NewAccount): Promise<void> {
  await db.run(
    `insert into account (id, email, password_hash, display_name, created)
     values (?, ?, ?, ?, ?)`,
    [a.id, normalise(a.email), a.passwordHash, a.displayName, new Date().toISOString()])
}

export async function recordSignInFailure(db: Db, email: string, at: string): Promise<void> {
  await db.run(`insert into sign_in_failure (id, email, failed_at) values (?, ?, ?)`,
               [crypto.randomUUID(), normalise(email), at])
}

/** How many times this address has failed since `sinceIso`. */
export async function recentSignInFailures(
  db: Db, email: string, sinceIso: string,
): Promise<number> {
  const row = await db.get<{ n: number }>(
    `select count(*) as n from sign_in_failure where email = ? and failed_at >= ?`,
    [normalise(email), sinceIso])
  return row?.n ?? 0
}

/**
 * Whether anybody holds an account here, or ever filed a gita, the public
 * demonstration's shared visitor aside. A demo build has neither; an archive
 * people use has both. The OpenStreetMap importer asks
 * before it writes anything (src/import/osm/guard.ts).
 */
export async function holdsPeople(db: Db): Promise<boolean> {
  // The demonstration's shared visitor is nobody: a demo it wrote into is still a demo.
  return (await db.get('select 1 from account where email <> ? limit 1', [VISITOR_EMAIL])) !== undefined
    || (await db.get(`select 1 from gita where account_id not in (select id from account where email = ?) limit 1`,
      [VISITOR_EMAIL])) !== undefined
}
