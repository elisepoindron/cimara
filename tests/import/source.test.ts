import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { readSource } from '../../src/import/source.ts'

const ARCHIVE = fileURLToPath(
  new URL('../../src/import/data/archivio.json', import.meta.url))

/** Valid JSON, and nothing like an archive export. */
const NOT_AN_ARCHIVE = fileURLToPath(new URL('../../package.json', import.meta.url))

/** Not JSON at all. This file. */
const NOT_JSON = fileURLToPath(import.meta.url)

test('it reads every row, including the ones it cannot use', async () => {
  const rows = await readSource(ARCHIVE)

  assert.ok(rows.length >= 20, 'a source worth testing against has some size')
  assert.ok(rows.some(r => r.titolo === undefined),
    'a row with no title is still a row; refusing it is not this function’s job')
})

test('every row knows where it came from', async () => {
  const rows = await readSource(ARCHIVE)
  assert.deepEqual(rows.map(r => r.riga), rows.map((_, i) => i + 1))
})

test('it judges nothing: a grade on no scale arrives as it was written', async () => {
  const rows = await readSource(ARCHIVE)
  assert.ok(rows.some(r => r.diff === 'AD/D'))
  assert.ok(rows.some(r => r.diff === '6a/6b'))
  assert.ok(rows.some(r => r.diff === 'III+'))
  assert.ok(rows.some(r => r.diff === ''), 'the empty string is a value, not an absence')
})

test('it judges nothing: a figure quoted on one row and bare on another keeps its type', async () => {
  const rows = await readSource(ARCHIVE)
  assert.ok(rows.some(r => typeof r.q_max === 'number'))
  assert.ok(rows.some(r => typeof r.disl === 'string'),
    'twenty years of forms leave numbers stored as text; coercing here would hide it')
})

test('it judges nothing: prose keeps the markup the web form left in it', async () => {
  const rows = await readSource(ARCHIVE)
  assert.ok(rows.some(r => typeof r.descr === 'string' && r.descr.includes('<b>')))
})

test('the archive carries coordinates written three ways', async () => {
  const rows = await readSource(ARCHIVE)
  assert.ok(rows.some(r => r.lat === '44.6721'), 'decimal, as text')
  assert.ok(rows.some(r => typeof r.lat === 'string' && r.lat.includes('°')), 'degrees, minutes, seconds')
  assert.ok(rows.some(r => r.lat === undefined), 'and a row that was never placed')
})

test('the archive carries two crags of one name in two places', async () => {
  const rows = await readSource(ARCHIVE)
  const scure = rows.filter(r => r.titolo === 'Balma Scura')

  assert.equal(scure.length, 2)
  assert.notEqual(scure[0]!.zona, scure[1]!.zona, 'same name, different comune: two crags')
})

test('the export header counts the records it carries', async () => {
  const header = JSON.parse(await readFile(ARCHIVE, 'utf8')) as { n_record: number }
  const rows = await readSource(ARCHIVE)
  assert.equal(rows.length, header.n_record)
})

test('a file that is not there fails loudly, naming it', async () => {
  await assert.rejects(readSource('/nowhere/archivio.json'), /archivio\.json/)
})

test('a file that is not an export fails loudly rather than reading nothing', async () => {
  await assert.rejects(readSource(NOT_AN_ARCHIVE), /itinerari/)
})

test('a file that is not JSON fails loudly, naming it', async () => {
  await assert.rejects(readSource(NOT_JSON), /source\.test\.ts/)
})
