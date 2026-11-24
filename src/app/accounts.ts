import { randomBytes } from 'node:crypto'
import type { Db } from '../db/open.ts'
import {
  findAccountByEmail, findAccountById, insertAccount, recordSignInFailure,
  recentSignInFailures, VISITOR_EMAIL, type AccountRow,
} from '../db/account.ts'
import {
  insertSession, findLiveSession, deleteSession, type NewSession,
} from '../db/session.ts'
import { hashPassword, verifyPassword, MIN_PASSWORD_LENGTH } from '../auth/password.ts'

export const SESSION_DAYS = 30
export const MAX_FAILURES = 5
export const THROTTLE_MINUTES = 15

export type SignUpResult =
  | { readonly ok: true; readonly accountId: string; readonly session: NewSession }
  | { readonly ok: false; readonly problems: readonly string[] }

export type SignInResult = SignUpResult

/** Deliberately loose: an address's real test is whether mail reaches it, and we send none. */
const LOOKS_LIKE_EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

function newSession(accountId: string, now: Date): NewSession {
  return {
    id: randomBytes(32).toString('base64url'),
    accountId,
    created: now.toISOString(),
    expires: new Date(now.getTime() + SESSION_DAYS * 86_400_000).toISOString(),
  }
}

export async function signUp(
  db: Db,
  input: { email: string; password: string; displayName: string },
  now: Date,
): Promise<SignUpResult> {
  const problems: string[] = []

  if (!LOOKS_LIKE_EMAIL.test(input.email.trim())) problems.push('Indirizzo non valido.')
  if (input.password.length < MIN_PASSWORD_LENGTH) {
    problems.push(MIN_PASSWORD_LENGTH === 1
      ? 'Scegli una password.'
      : `La password deve avere almeno ${MIN_PASSWORD_LENGTH} caratteri.`)
  }
  if (input.displayName.trim() === '') problems.push('Scegli un nome.')

  // Reported all at once, as resolveFacts does: one attempt, every problem.
  if (problems.length) return { ok: false, problems }

  if (await findAccountByEmail(db, input.email)) {
    return { ok: false, problems: ['Questo indirizzo è già registrato.'] }
  }

  const accountId = crypto.randomUUID()
  await insertAccount(db, {
    id: accountId,
    email: input.email,
    passwordHash: await hashPassword(input.password),
    displayName: input.displayName.trim(),
  })

  // Inserted here, not merely returned: signUp already holds the Db, and
  // handing the caller a session it must remember to persist is a trap.
  const session = newSession(accountId, now)
  await insertSession(db, session)

  return { ok: true, accountId, session }
}

/** One message for every failure: a different one would reveal which addresses exist. */
const REFUSED = ['Indirizzo o password non corretti.'] as const

// A real hash of a secret nobody knows, so an unknown address costs the same
// scrypt work as a wrong password. A placeholder that fails validation early
// would return in microseconds and leak which addresses exist. Computed
// lazily and cached, so the cost lands on the first sign-in attempt rather
// than on every import, and test files that never sign anyone in pay nothing.
let dummyHash: Promise<string> | undefined
function dummy(): Promise<string> {
  dummyHash ??= hashPassword(randomBytes(32).toString('hex'))
  return dummyHash
}

export async function signIn(
  db: Db, input: { email: string; password: string }, now: Date,
): Promise<SignInResult> {
  const since = new Date(now.getTime() - THROTTLE_MINUTES * 60_000).toISOString()

  if (await recentSignInFailures(db, input.email, since) >= MAX_FAILURES) {
    return { ok: false, problems: [`Troppi tentativi. Riprova fra ${THROTTLE_MINUTES} minuti.`] }
  }

  const account = await findAccountByEmail(db, input.email)
  // Verify even when there is no account, so a missing address and a wrong
  // password take the same time as well as giving the same answer.
  const ok = await verifyPassword(input.password, account?.passwordHash ?? await dummy())

  if (!account || !ok) {
    await recordSignInFailure(db, input.email, now.toISOString())
    return { ok: false, problems: [...REFUSED] }
  }

  // Inserted here for the same reason as in signUp: the caller only ever
  // receives a session that already exists.
  const session = newSession(account.id, now)
  await insertSession(db, session)

  return { ok: true, accountId: account.id, session }
}

/** The name every visitor of the public demonstration writes under. */
export const VISITOR_NAME = 'Visitatore'

/**
 * Signs a visitor of the public demonstration into its one shared account,
 * made the first time anyone enters. Its password is random and never kept,
 * so this is the only way in: nobody can sign in to it by address.
 */
export async function visitorSignIn(db: Db, now: Date): Promise<{ readonly accountId: string; readonly session: NewSession }> {
  const accountId = await visitorAccount(db)
  const session = newSession(accountId, now)
  await insertSession(db, session)
  return { accountId, session }
}

/**
 * The public demonstration's one shared account, by id: made the first time
 * it is asked for — by the first visitor, or by the demo's build, which stars
 * the showcase routes for it.
 */
export async function visitorAccount(db: Db): Promise<string> {
  const held = await findAccountByEmail(db, VISITOR_EMAIL)
  if (held) return held.id
  await insertAccount(db, {
    id: crypto.randomUUID(), email: VISITOR_EMAIL,
    passwordHash: await hashPassword(randomBytes(32).toString('hex')), displayName: VISITOR_NAME,
  })
  return (await findAccountByEmail(db, VISITOR_EMAIL))!.id
}

export async function signOut(db: Db, sessionId: string): Promise<void> {
  await deleteSession(db, sessionId)
}

export async function accountForSession(
  db: Db, sessionId: string | undefined, now: Date,
): Promise<AccountRow | null> {
  if (!sessionId) return null

  const session = await findLiveSession(db, sessionId, now.toISOString())
  if (!session) return null

  return findAccountById(db, session.accountId)
}
