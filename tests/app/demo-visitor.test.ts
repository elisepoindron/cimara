import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { freshDb } from '../helpers/db.ts'
import { memoryPhotoStore } from '../helpers/photo-store.ts'
import { post, tokenFrom } from '../helpers/http.ts'
import { createServer, type ServerOptions } from '../../src/app/server.ts'
import { findAccountByEmail, holdsPeople, insertAccount, VISITOR_EMAIL } from '../../src/db/account.ts'
import { favoriteIdsOf } from '../../src/db/favorite.ts'
import type { Db } from '../../src/db/open.ts'

/** The public demonstration, on its own port, over a fresh database holding one crag. */
async function demo(options: ServerOptions = {}): Promise<{ db: Db; base: string; close: () => void; itineraryId: string }> {
  const db = await freshDb()
  const place = crypto.randomUUID(), itineraryId = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Arnad', 'comune')`, [place])
  await db.run(`insert into itinerary (id, activity, place_id, name, facts, created) values (?, 'falesia', ?, 'Corno di Prova', '{}', ?)`,
    [itineraryId, place, new Date().toISOString()])
  const server = createServer(db, memoryPhotoStore(), memoryPhotoStore(), null, null, null, null, null, { publicDemo: true, ...options })
  server.listen(0)
  await once(server, 'listening')
  return { db, base: `http://127.0.0.1:${(server.address() as { port: number }).port}`, close: () => server.close(), itineraryId }
}

const count = async (db: Db, table: string) => (await db.get<{ n: number }>(`select count(*) as n from ${table}`))!.n

/** Enters as the visitor, returning the cookies a browser would then send. */
async function enter(base: string, next?: string): Promise<{ cookie: string; location: string | null }> {
  const { token, cookie } = await tokenFrom(base, '/accedi')
  const r = await post(base, '/accedi', { csrf: token, ...(next ? { next } : {}) }, cookie)
  assert.equal(r.status, 303)
  const session = r.cookies.map(c => c.split(';')[0]).join('; ')
  return { cookie: [cookie, session].filter(Boolean).join('; '), location: r.location }
}

test('the way in is one button into the shared account, and nobody signs up', async () => {
  const d = await demo()
  try {
    const page = await (await fetch(d.base + '/accedi')).text()
    assert.match(page, /Entra come visitatore/)
    assert.doesNotMatch(page, /type="password"/)
    assert.doesNotMatch(page, /type="email"/)
    const signUp = await fetch(d.base + '/registrati', { redirect: 'manual' })
    assert.equal(signUp.status, 303)
    assert.equal(signUp.headers.get('location'), '/accedi')
  } finally { d.close() }
})

test('entering needs the form’s token, and every visitor enters the same account', async () => {
  const d = await demo()
  try {
    assert.equal((await post(d.base, '/accedi', {})).status, 403)
    assert.equal(await count(d.db, 'account'), 0)

    const first = await enter(d.base, '/preferiti')
    assert.equal(first.location, '/preferiti')
    await enter(d.base)
    assert.equal(await count(d.db, 'account'), 1)
    assert.equal(await count(d.db, 'session'), 2)
    const visitor = (await findAccountByEmail(d.db, VISITOR_EMAIL))!
    assert.equal(visitor.displayName, 'Visitatore')

    // A demo the visitor wrote into is still a demo; a real account is not.
    assert.equal(await holdsPeople(d.db), false)
    await insertAccount(d.db, { id: crypto.randomUUID(), email: 'a@example.invalid', passwordHash: 'x', displayName: 'A' })
    assert.equal(await holdsPeople(d.db), true)
  } finally { d.close() }
})

test('the visitor stars a route as anyone signed in would', async () => {
  const d = await demo()
  try {
    const { cookie } = await enter(d.base)
    const page = await fetch(d.base + '/preferiti', { headers: { cookie } })
    assert.equal(page.status, 200)
    const token = /name="csrf" value="([^"]+)"/.exec(await page.text())?.[1] ?? ''
    const star = await post(d.base, `/preferiti/${d.itineraryId}`, { csrf: token }, cookie)
    assert.equal(star.status, 303)
    const visitor = (await findAccountByEmail(d.db, VISITOR_EMAIL))!
    assert.deepEqual([...await favoriteIdsOf(d.db, visitor.id, [d.itineraryId])], [d.itineraryId])
  } finally { d.close() }
})

test('past its ceiling, the demo takes no more reports or photos for now, and says so', async () => {
  const none = { perMinute: 0, perHour: 0, perDay: 0 }
  const d = await demo({ demoLimits: { reports: none, photos: none } })
  try {
    const { cookie } = await enter(d.base)
    for (const path of ['/gita', '/gita/foto']) {
      const r = await post(d.base, path, {}, cookie)
      assert.equal(r.status, 429, path)
      assert.match(r.body, /Riprova più tardi/, path)
    }
    assert.equal(await count(d.db, 'gita'), 0)
  } finally { d.close() }
})
