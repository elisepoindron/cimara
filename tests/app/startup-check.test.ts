import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { checkRegistryAgainstStore, RegistryMismatch } from '../../src/app/startup-check.ts'
import type { Db } from '../../src/db/open.ts'

async function store(db: Db, activity: string, facts: string): Promise<void> {
  const place = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [place])
  await db.run(`insert into itinerary (id, activity, place_id, name, facts, created)
                values (?, ?, ?, 'Prova', ?, ?)`,
               [crypto.randomUUID(), activity, place, facts, new Date().toISOString()])
}

const GOOD = '{"difficolta":"AD","dislivello":2000,"partenza":2020,"vetta":3841,"esposizione":"SE","giorni":2}'

test('a store that matches its registry passes', async () => {
  const db = await freshDb()
  await store(db, 'alpinismo', GOOD)
  await checkRegistryAgainstStore(db)          // does not throw
})

test('a section id declared only in the rail is still read, and caught there when it is not prose', async () => {
  // "foto" is declared in alpinismo's rail, not its document, and as furniture,
  // not prose. The check must read the whole registry — both columns — and it
  // must be the kind mismatch that fires (not "undeclared"), which is only
  // possible if the rail was actually consulted to find "foto" and see its kind.
  const db = await freshDb()
  const place = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [place])
  await db.run(`insert into itinerary (id, activity, place_id, name, facts, sections, created)
                values (?, 'alpinismo', ?, 'Prova', ?, ?, ?)`,
               [crypto.randomUUID(), place, GOOD, JSON.stringify({ foto: 'Testo.' }),
                new Date().toISOString()])

  const err = await checkRegistryAgainstStore(db).catch(e => e) as RegistryMismatch
  assert.ok(err instanceof RegistryMismatch)
  assert.match(err.problems.join('\n'), /foto/)
  assert.match(err.problems.join('\n'), /not prose/)
})

test('a crag’s history, stored under its run-in id, is prose the registry declares', async () => {
  // "storia" is no section of its own: falesia's note draws it. The check must
  // read it as the note's, or every crag with a Storico would stop the boot.
  const db = await freshDb()
  const place = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [place])
  await db.run(`insert into itinerary (id, activity, place_id, name, facts, sections, created)
                values (?, 'falesia', ?, 'Prova', ?, ?, ?)`,
               [crypto.randomUUID(), place, '{}',
                JSON.stringify({ note: 'Bella.', storia: 'Chiodata negli anni ’80.' }),
                new Date().toISOString()])
  await checkRegistryAgainstStore(db).catch(e => {
    // facts a bare crag lacks may be reported; the history must not be
    if (!(e instanceof RegistryMismatch)) throw e
    assert.doesNotMatch(e.problems.join('\n'), /storia/)
  })
})

test('a run-in id is prose only for the activity that declares it', async () => {
  const db = await freshDb()
  const place = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [place])
  await db.run(`insert into itinerary (id, activity, place_id, name, facts, sections, created)
                values (?, 'alpinismo', ?, 'Prova', ?, ?, ?)`,
               [crypto.randomUUID(), place, GOOD, JSON.stringify({ storia: 'Testo.' }),
                new Date().toISOString()])
  const err = await checkRegistryAgainstStore(db).catch(e => e) as RegistryMismatch
  assert.ok(err instanceof RegistryMismatch)
  assert.match(err.problems.join('\n'), /undeclared section "storia"/)
})

test('prose orphaned by a registry section that changed kind is caught at startup, not silently dropped at render', async () => {
  // "accesso" moved from a prose section to a furniture one on this branch. A
  // database seeded or imported before that move still holds real prose under
  // "accesso" and none of the four new access facts. Undetected, the boot
  // check passes (accesso is still a declared id) and the page renders no
  // "Accesso e parcheggio" section at all — content vanishes with no warning.
  const db = await freshDb()
  const place = crypto.randomUUID()
  await db.run(`insert into place (id, name, kind) values (?, 'Piemonte', 'regione')`, [place])
  await db.run(`insert into itinerary (id, activity, place_id, name, facts, sections, created)
                values (?, 'alpinismo', ?, 'Prova', ?, ?, ?)`,
               [crypto.randomUUID(), place, GOOD, JSON.stringify({ accesso: 'Some old prose.' }),
                new Date().toISOString()])

  const err = await checkRegistryAgainstStore(db).catch(e => e) as RegistryMismatch
  assert.ok(err instanceof RegistryMismatch)
  assert.match(err.problems.join('\n'), /Prova/)
  assert.match(err.problems.join('\n'), /accesso/)
})

test('an activity no registry file declares is caught at startup, not at render', async () => {
  const db = await freshDb()
  await store(db, 'parapendio', '{}')
  const err = await checkRegistryAgainstStore(db).catch(e => e) as RegistryMismatch

  assert.ok(err instanceof RegistryMismatch)
  assert.match(err.problems.join('\n'), /parapendio/)
})

test('a stored fact the registry rejects names the itinerary and the field', async () => {
  const db = await freshDb()
  await store(db, 'alpinismo', GOOD.replace('"AD"', '"6a"'))
  const err = await checkRegistryAgainstStore(db).catch(e => e) as RegistryMismatch

  assert.match(err.problems.join('\n'), /Prova/)
  assert.match(err.problems.join('\n'), /difficolta/)
})

test('a bad access fact names the itinerary and the field too', async () => {
  const db = await freshDb()
  await store(db, 'alpinismo', GOOD.replace('}', ',"come_arrivare":123}'))
  const err = await checkRegistryAgainstStore(db).catch(e => e) as RegistryMismatch

  assert.match(err.problems.join('\n'), /Prova/)
  assert.match(err.problems.join('\n'), /come_arrivare/)
})

test('two bad rows are both reported, not just the first one found', async () => {
  const db = await freshDb()
  await store(db, 'parapendio', '{}')
  await store(db, 'alpinismo', GOOD.replace('"AD"', '"6a"'))
  const err = await checkRegistryAgainstStore(db).catch(e => e) as RegistryMismatch

  assert.ok(err instanceof RegistryMismatch)
  assert.match(err.problems.join('\n'), /parapendio/)
  assert.match(err.problems.join('\n'), /difficolta/)
})
