import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import {
  signUp, signIn, signOut, accountForSession, MAX_FAILURES,
} from '../../src/app/accounts.ts'

const NOW = new Date('2026-09-11T10:00:00.000Z')
const GOOD = { email: 'elise@example.it', password: 'una password lunga', displayName: 'elise' }

test('signing up creates an account and signs you in', async () => {
  const db = await freshDb()
  const r = await signUp(db, GOOD, NOW)

  assert.equal(r.ok, true)
  if (!r.ok) return
  assert.ok(await accountForSession(db, r.session.id, NOW))
})

test('every problem is reported at once, in Italian', async () => {
  const db = await freshDb()
  const r = await signUp(db, { email: 'non-un-indirizzo', password: '', displayName: '' }, NOW)

  assert.equal(r.ok, false)
  if (r.ok) return
  assert.equal(r.problems.length, 3, 'one attempt should surface all three')
  assert.match(r.problems.join(' '), /indirizzo/i)
  assert.match(r.problems.join(' '), /password/i)
  assert.match(r.problems.join(' '), /nome/i)
})

test('an address already registered is refused', async () => {
  const db = await freshDb()
  await signUp(db, GOOD, NOW)
  const again = await signUp(db, { ...GOOD, displayName: 'altra' }, NOW)

  assert.equal(again.ok, false)
})

test('the password is never stored as typed', async () => {
  const db = await freshDb()
  await signUp(db, GOOD, NOW)

  const rows = await db.all<{ password_hash: string }>('select password_hash from account')
  assert.equal(rows[0]!.password_hash.includes('una password lunga'), false)
  assert.match(rows[0]!.password_hash, /^scrypt\$/)
})

test('signing in works with the right password and not the wrong one', async () => {
  const db = await freshDb()
  await signUp(db, GOOD, NOW)

  assert.equal((await signIn(db, { email: GOOD.email, password: GOOD.password }, NOW)).ok, true)
  assert.equal((await signIn(db, { email: GOOD.email, password: 'sbagliata!!' }, NOW)).ok, false)
})

test('an unknown address fails the same way a wrong password does', async () => {
  const db = await freshDb()
  await signUp(db, GOOD, NOW)

  const unknown = await signIn(db, { email: 'nessuno@example.it', password: GOOD.password }, NOW)
  const wrong = await signIn(db, { email: GOOD.email, password: 'sbagliata!!' }, NOW)

  assert.equal(unknown.ok, false)
  assert.equal(wrong.ok, false)
  if (unknown.ok || wrong.ok) return
  assert.deepEqual(unknown.problems, wrong.problems,
    'a different message would tell an attacker which addresses exist')
})

test('repeated failures throttle that address and no other', async () => {
  const db = await freshDb()
  await signUp(db, GOOD, NOW)
  await signUp(db, { email: 'altro@example.it', password: 'un altra lunga', displayName: 'a' }, NOW)

  for (let i = 0; i < MAX_FAILURES; i++) {
    await signIn(db, { email: GOOD.email, password: 'sbagliata!!' }, NOW)
  }

  const throttled = await signIn(db, { email: GOOD.email, password: GOOD.password }, NOW)
  assert.equal(throttled.ok, false, 'the right password must not lift the throttle')

  const other = await signIn(db, { email: 'altro@example.it', password: 'un altra lunga' }, NOW)
  assert.equal(other.ok, true, 'one address being throttled must not lock out another')
})

test('the throttle lifts once the window has passed', async () => {
  const db = await freshDb()
  await signUp(db, GOOD, NOW)
  for (let i = 0; i < MAX_FAILURES; i++) {
    await signIn(db, { email: GOOD.email, password: 'sbagliata!!' }, NOW)
  }

  const later = new Date(NOW.getTime() + 16 * 60 * 1000)
  assert.equal((await signIn(db, { email: GOOD.email, password: GOOD.password }, later)).ok, true)
})

test('signing out ends the session', async () => {
  const db = await freshDb()
  const r = await signUp(db, GOOD, NOW)
  if (!r.ok) return assert.fail('sign-up failed')

  // signUp already inserted the session — it hands back a session the caller
  // must remember to persist otherwise, which is the trap this task avoids.
  await signOut(db, r.session.id)
  assert.equal(await accountForSession(db, r.session.id, NOW), null)
})

test('no cookie at all is simply nobody', async () => {
  const db = await freshDb()
  assert.equal(await accountForSession(db, undefined, NOW), null)
})

test('an unknown address costs the same work as a wrong password', async () => {
  const db = await freshDb()
  await signUp(db, { email: 'vero@example.it', password: 'una password lunga', displayName: 'v' }, NOW)

  const time = async (email: string) => {
    const t = process.hrtime.bigint()
    await signIn(db, { email, password: 'sbagliata!!' }, NOW)
    return Number(process.hrtime.bigint() - t) / 1e6
  }

  // Two different never-registered addresses, so neither trips the other's
  // throttle, averaged for a steadier reading of the "no account" cost.
  const unknown = ((await time('nessuno@example.it')) + (await time('altro@example.it'))) / 2
  const wrong = await time('vero@example.it')

  // Both paths should do a real scrypt derivation; the ratio should be near 1,
  // not near 1000. A generous, order-of-magnitude margin keeps this from
  // flaking on a loaded machine while still catching a dummy that returns
  // near-instantly.
  assert.ok(unknown > wrong / 10,
    `an unknown address returned in ${unknown}ms against ${wrong}ms for a wrong password — ` +
    'that gap tells an attacker which addresses exist')
})
