import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertAccount } from '../../src/db/account.ts'
import { insertSession, findLiveSession, deleteSession, deleteExpiredSessions }
  from '../../src/db/session.ts'

async function withAccount() {
  const db = await freshDb()
  await insertAccount(db, { id: 'a1', email: 'e@example.it', passwordHash: 'h', displayName: 'e' })
  return db
}

const S = { id: 's1', accountId: 'a1', created: '2026-09-11T10:00:00.000Z',
            expires: '2026-10-11T10:00:00.000Z' }

test('a live session is found; an expired one is not', async () => {
  const db = await withAccount()
  await insertSession(db, S)

  assert.equal((await findLiveSession(db, 's1', '2026-09-20T00:00:00.000Z'))?.accountId, 'a1')
  assert.equal(await findLiveSession(db, 's1', '2026-10-20T00:00:00.000Z'), null,
    'past its expiry it must not authenticate anyone')
})

test('signing out kills the session everywhere, not just in one browser', async () => {
  const db = await withAccount()
  await insertSession(db, S)
  await deleteSession(db, 's1')

  assert.equal(await findLiveSession(db, 's1', '2026-09-20T00:00:00.000Z'), null)
})

test('an unknown session id is null rather than an error', async () => {
  const db = await withAccount()
  assert.equal(await findLiveSession(db, 'mai-esistita', '2026-09-20T00:00:00.000Z'), null)
})

test('expired sessions can be swept without touching live ones', async () => {
  const db = await withAccount()
  await insertSession(db, S)
  await insertSession(db, { ...S, id: 's2', expires: '2026-09-12T10:00:00.000Z' })

  await deleteExpiredSessions(db, '2026-09-20T00:00:00.000Z')
  assert.equal(await findLiveSession(db, 's2', '2026-09-13T00:00:00.000Z'), null)
  assert.ok(await findLiveSession(db, 's1', '2026-09-20T00:00:00.000Z'))
})
