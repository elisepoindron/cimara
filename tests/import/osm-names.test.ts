import { test } from 'node:test'
import assert from 'node:assert/strict'
import { tellNamesApart } from '../../src/import/osm/names.ts'
import type { OsmVocabulary } from '../../src/import/osm/translate.ts'
import type { OsmRow } from '../../src/import/osm/source.ts'

const known: OsmVocabulary = {
  comuneByIstat: { '007004': 'p-arnad', '007023': 'p-donnas' },
  comuneByName: { Arnad: 'p-arnad', Donnas: 'p-donnas' },
  provinces: new Set(['001', '007']),
  created: '2026-11-19T00:00:00.000Z',
}
const crag = (osm: string, name: string, lat: number, lon: number, comune: [string, string], tags: Record<string, string> = {}): OsmRow => ({
  osm, source: 'climbing', tags: { name, sport: 'climbing', ...tags },
  point: { lat, lon }, track: null, comune: { name: comune[0], istat: comune[1] },
  terrain: { ele: 1189, slope: 49, facing: 225 }, onMarkedPath: false, area: null,
})
const names = (rows: OsmRow[]) => rows.map(r => r.tags.name)

test('two places far apart with one name are told apart by their comune', () => {
  const out = tellNamesApart([crag('n1', 'Cascata', 45.6, 7.7, ['Arnad', '007004']), crag('n2', 'Cascata', 45.9, 7.9, ['Donnas', '007023'])], known)
  assert.deepEqual(names(out), ['Cascata (Arnad)', 'Cascata (Donnas)'])
})

test('pieces of one place within ten km keep their one name, and a lone name is untouched', () => {
  const rows = [crag('n1', 'Balma', 45.60, 7.70, ['Arnad', '007004']), crag('n2', 'Balma', 45.61, 7.70, ['Donnas', '007023']), crag('n3', 'Unica', 45.9, 7.9, ['Arnad', '007004'])]
  assert.deepEqual(names(tellNamesApart(rows, known)), ['Balma', 'Balma', 'Unica'])
})

test('a cluster of pieces beside a far homonym is labelled once, by its first comune', () => {
  const rows = [crag('n1', 'Balma', 45.60, 7.70, ['Donnas', '007023']), crag('n2', 'Balma', 45.61, 7.70, ['Arnad', '007004']), crag('n3', 'Balma', 46.5, 8.5, ['Donnas', '007023'])]
  assert.deepEqual(names(tellNamesApart(rows, known)), ['Balma (Arnad)', 'Balma (Arnad)', 'Balma (Donnas)'])
})

test('stages of one route, each with its ends, are named by them', () => {
  const rows = [
    crag('n1', 'Giro', 45.6, 7.7, ['Arnad', '007004'], { from: 'A', to: 'B' }),
    crag('n2', 'Giro', 45.9, 7.9, ['Donnas', '007023'], { from: 'B', to: 'C' }),
  ]
  assert.deepEqual(names(tellNamesApart(rows, known)), ['Giro: A – B', 'Giro: B – C'])
})
