import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import type { Db } from '../../src/db/open.ts'

/** A place and a route to hang an observation on. */
async function anItinerary(db: Db): Promise<string> {
  const placeId = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [placeId])
  const itin = crypto.randomUUID()
  await db.run(`insert into itinerary (id, activity, place_id, name, created)
                values (?, 'alpinismo', ?, 'Prova', '2026-09-11')`, [itin, placeId])
  return itin
}

test('the four contributor tables exist and are strict', async () => {
  const db = await freshDb()
  const rows = await db.all<{ name: string; sql: string }>(
    `select name, sql from sqlite_master where type = 'table'
     and name in ('account','session','gita','retraction') order by name`)

  assert.deepEqual(rows.map(r => r.name), ['account', 'gita', 'retraction', 'session'])
  for (const r of rows) assert.match(r.sql, /\bstrict\b/i, `${r.name} is not strict`)
})

test('an email address is unique, and stored as given', async () => {
  const db = await freshDb()
  const one = async (email: string) =>
    db.run(`insert into account (id, email, password_hash, display_name, created)
            values (?, ?, 'x', 'Chi', '2026-09-11')`, [crypto.randomUUID(), email])

  await one('elise@example.it')
  await assert.rejects(one('elise@example.it'), /UNIQUE|unique/)

  // "stored as given" is half the test's name and was never checked. The column
  // is not case-folded, so two addresses differing only in case are two rows —
  // which is a decision, not an accident, and `signUp` lower-cases before it
  // reaches here.
  await one('ELISE@example.it')
  const rows = await db.all<{ email: string }>(`select email from account order by email`)
  assert.deepEqual(rows.map(r => r.email), ['ELISE@example.it', 'elise@example.it'])
})

test('sign_in_failure is declared strict, and the declaration is enforced', async () => {
  const db = await freshDb()

  const declared = await db.get<{ sql: string }>(
    `select sql from sqlite_master where type = 'table' and name = 'sign_in_failure'`)
  assert.match(declared!.sql, /\bstrict\b/i)

  // What strict actually refuses on an all-text table is a blob. It does NOT
  // refuse an integer: converting 1 to '1' is lossless, so a strict table takes
  // it — which is worth a test saying so, because "strict" reads like it would
  // not, and a test asserting the wrong refusal passes for the wrong reason.
  await assert.rejects(
    db.run(`insert into sign_in_failure (id, email, failed_at) values (?, ?, x'0102')`,
           [crypto.randomUUID(), 'elise@example.it']),
    /BLOB/i)

  await db.run(`insert into sign_in_failure (id, email, failed_at) values (?, ?, 1)`,
               [crypto.randomUUID(), 'elise@example.it'])

  // The guard the throttle actually leans on is NOT NULL: a failure with no
  // address is a failure it could never count against anybody.
  await assert.rejects(
    db.run(`insert into sign_in_failure (id, email, failed_at) values (?, null, 'x')`,
           [crypto.randomUUID()]),
    /NOT NULL/i)
})
