import { test, type TestContext } from 'node:test'
import assert from 'node:assert/strict'
import { copyFile, mkdtemp, readdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { openDb } from '../../src/db/open.ts'
import { migrate } from '../../db/migrate.ts'
import { ACTIVITIES } from '../../src/domain/activities/index.ts'
import { gradeScale } from '../../src/domain/quantity.ts'

const MIGRATIONS = fileURLToPath(new URL('../../db/migrations/', import.meta.url))
const MIGRATION = '017_sport_plus_steps.sql'

/** The sport scale as it was before 017, which is what stored ordinals were counted on. */
const BEFORE = ['3', '4a', '4b', '4c', '5a', '5b', '5c',
  '6a', '6a+', '6b', '6b+', '6c', '6c+', '7a', '7a+', '7b', '7b+', '7c', '7c+',
  '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a']

/** Every real migration before 017, copied into a directory of their own. */
async function migrationsBefore(t: TestContext): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'app-mig-'))
  t.after(() => rm(dir, { recursive: true, force: true }))
  for (const f of await readdir(MIGRATIONS)) {
    if (f.endsWith('.sql') && f < MIGRATION) await copyFile(join(MIGRATIONS, f), join(dir, f))
  }
  return dir
}

test('017 moves every stored sport ordinal to where its grade sits on the new scale', async (t) => {
  const dir = await migrationsBefore(t)
  const db = openDb(':memory:')
  await migrate(db, dir)
  await db.run(`insert into place (id, name, kind) values ('p', 'Prova', 'regione')`)

  // One crag per old step, graded from that step up to 9a, so both columns move.
  for (const [i, grade] of BEFORE.entries()) {
    await db.run(`insert into itinerary (id, activity, place_id, name, created, grade_min, grade_max)
                  values (?, 'falesia', 'p', ?, '2026-09-01T00:00:00.000Z', ?, ?)`,
      [`f${i}`, `Falesia ${grade}`, i, BEFORE.length - 1])
  }

  await copyFile(join(MIGRATIONS, MIGRATION), join(dir, MIGRATION))
  assert.deepEqual(await migrate(db, dir), [MIGRATION])

  const sport = gradeScale('sport')
  for (const [i, grade] of BEFORE.entries()) {
    const row = await db.get<{ grade_min: number; grade_max: number }>(
      'select grade_min, grade_max from itinerary where id = ?', [`f${i}`])
    assert.equal(row!.grade_min, sport.ordinal(grade), `${grade} was ${i}`)
    assert.equal(row!.grade_max, sport.ordinal('9a'))
  }
})

test('017 leaves alpine ordinals and ungraded routes alone', async (t) => {
  const dir = await migrationsBefore(t)
  const db = openDb(':memory:')
  await migrate(db, dir)
  await db.run(`insert into place (id, name, kind) values ('p', 'Prova', 'regione')`)
  const ad = gradeScale('alpine').ordinal('AD')
  await db.run(`insert into itinerary (id, activity, place_id, name, created, grade_min, grade_max)
                values ('a', 'alpinismo', 'p', 'Cresta', '2026-09-01T00:00:00.000Z', ?, ?)`, [ad, ad])
  await db.run(`insert into itinerary (id, activity, place_id, name, created)
                values ('n', 'falesia', 'p', 'Senza vie', '2026-09-01T00:00:00.000Z')`)

  await copyFile(join(MIGRATIONS, MIGRATION), join(dir, MIGRATION))
  await migrate(db, dir)

  const alpine = await db.get<{ grade_min: number }>(`select grade_min from itinerary where id = 'a'`)
  assert.equal(alpine!.grade_min, ad)
  const none = await db.get<{ grade_min: number | null }>(`select grade_min from itinerary where id = 'n'`)
  assert.equal(none!.grade_min, null, 'absent is not zero, and does not become six')
})

test('falesia is the only sport-graded activity 017 had rows to move', () => {
  // multipitch is graded on the sport scale too, but it was declared after 017
  // ran, so every ordinal it ever stored was written on the scale with the
  // plus steps. A migration that moves sport ordinals again must move both.
  const sport = Object.values(ACTIVITIES)
    .filter(a => [...a.facts, ...(a.parts?.fields ?? [])].some(f => f.quantity.kind === 'grade:sport'))
    .map(a => a.id)
    .sort()
  assert.deepEqual(sport, ['falesia', 'multipitch'],
    'a new sport-graded activity has stored ordinals a step migration must move; name it here and there')
})

test('the six plus steps sit between the steps they qualify', () => {
  const sport = gradeScale('sport')
  const steps: [string, string, string][] = [['4a', '4a+', '4b'], ['4b', '4b+', '4c'], ['4c', '4c+', '5a'],
                                             ['5a', '5a+', '5b'], ['5b', '5b+', '5c'], ['5c', '5c+', '6a']]
  for (const [plain, plus, next] of steps) {
    assert.equal(sport.ordinal(plus), sport.ordinal(plain) + 1, plus)
    assert.equal(sport.ordinal(next), sport.ordinal(plus) + 1, next)
  }
})
