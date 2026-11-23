import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { findAccountByEmail, findAccountById, insertAccount, recordSignInFailure,
  recentSignInFailures } from '../../src/db/account.ts'

const NEW = { id: 'a1', email: 'elise@example.it', passwordHash: 'scrypt$…', displayName: 'elise' }

test('an account round-trips by email', async () => {
  const db = await freshDb()
  await insertAccount(db, NEW)

  const found = await findAccountByEmail(db, 'elise@example.it')
  assert.equal(found?.id, 'a1')
  assert.equal(found?.displayName, 'elise')
  assert.equal(found?.passwordHash, 'scrypt$…')
})

test('email is matched case-insensitively, because an address is not case-sensitive', async () => {
  const db = await freshDb()
  await insertAccount(db, { ...NEW, email: 'Elise@Example.IT  ' })

  assert.ok(await findAccountByEmail(db, 'elise@example.it'))
  assert.ok(await findAccountByEmail(db, '  ELISE@EXAMPLE.IT'))
})

test('an unknown address is null, not an error', async () => {
  const db = await freshDb()
  assert.equal(await findAccountByEmail(db, 'nessuno@example.it'), null)
})

test('an account round-trips by id, with its email already normalised', async () => {
  const db = await freshDb()
  await insertAccount(db, { ...NEW, email: 'Elise@Example.IT  ' })

  const found = await findAccountById(db, 'a1')
  assert.equal(found?.id, 'a1')
  assert.equal(found?.email, 'elise@example.it',
    'insertAccount normalised it on the way in; findAccountById does no normalising of its own')
  assert.equal(found?.displayName, 'elise')
  assert.equal(found?.passwordHash, 'scrypt$…')
})

test('an unknown id is null, not an error', async () => {
  const db = await freshDb()
  assert.equal(await findAccountById(db, 'never-existed'), null)
})

test('sign-in failures are counted per address within a window', async () => {
  const db = await freshDb()
  await recordSignInFailure(db, 'elise@example.it', '2026-09-11T10:00:00.000Z')
  await recordSignInFailure(db, 'elise@example.it', '2026-09-11T10:05:00.000Z')
  await recordSignInFailure(db, 'altro@example.it', '2026-09-11T10:05:00.000Z')

  assert.equal(await recentSignInFailures(db, 'elise@example.it', '2026-09-11T09:50:00.000Z'), 2)
  assert.equal(await recentSignInFailures(db, 'elise@example.it', '2026-09-11T10:02:00.000Z'), 1,
    'older failures fall out of the window')
  assert.equal(await recentSignInFailures(db, 'altro@example.it', '2026-09-11T09:50:00.000Z'), 1,
    'one address being throttled must not throttle another')
})
