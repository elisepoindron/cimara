import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { giudiziLine } from '../../src/render/giudizi.ts'
import { resolveFacts } from '../../src/domain/facts.ts'
import { defineActivity, fact } from '../../src/domain/registry.ts'
import { count } from '../../src/domain/quantity.ts'
import { activityOf } from '../../src/domain/activities/index.ts'

const parts = [{ id: 'v1', group: null, position: 1, fields: { nome: 'Via 1', grado: '6a', lunghezza: 14 } }]
const base = { esposizione: 'S', quota_base: 780, avvicinamento: 20 }

function line(stored: Record<string, unknown>) {
  const out = giudiziLine(resolveFacts(activityOf('falesia'), { ...base, ...stored }, parts))
  return parseHTML(`<!doctype html><body>${out === null ? '' : render(out)}</body>`).document
}

test('five ratings, in the registry’s order, each a label and its stars, on a line with no title', () => {
  const doc = line({ bellezza: 4, chiodatura: 4, tranquillita: 3, comodita: 3, voto_parcheggio: 2 })
  const dl = doc.querySelector('dl.cls.cls--gz')!
  assert.equal(dl.getAttribute('aria-label'), 'Giudizi')
  assert.equal(doc.querySelectorAll('h2').length, 0)
  assert.deepEqual([...doc.querySelectorAll('.cls--gz dt')].map(n => n.textContent),
    ['Bellezza', 'Chiodatura', 'Tranquillità', 'Comodità', 'Parcheggio'])
  assert.deepEqual([...doc.querySelectorAll('.gz__st')].map(n => n.getAttribute('aria-label')),
    ['4 su 5', '4 su 5', '3 su 5', '3 su 5', '2 su 5'])
})

test('the stars are five glyphs, the earned ones marked', () => {
  const doc = line({ bellezza: 2 })
  const st = doc.querySelector('.gz__st')!
  assert.equal(st.getAttribute('role'), 'img')
  assert.equal(st.textContent, '★★★★★')
  assert.equal(st.querySelector('.on')!.textContent, '★★')
})

test('a rating nobody gave reads as a dash, and the line stays', () => {
  const doc = line({})
  assert.equal(doc.querySelectorAll('.cls--gz div').length, 5)
  assert.deepEqual([...doc.querySelectorAll('.cls--gz dd')].map(n => n.textContent), ['—', '—', '—', '—', '—'])
  assert.equal(doc.querySelectorAll('.gz__st').length, 0)
})

test('an activity with no ratings has no line', () => {
  const out = giudiziLine([])
  assert.equal(out, null)
})

test('only a stars quantity is drawn as stars; a count in giudizi is plain text', () => {
  const odd = defineActivity({
    id: 'prova', label: { it: 'Prova' },
    facts: [fact('tiri', count, { label: { it: 'Tiri' }, placement: 'giudizi' })],
    document: [], rail: [], current: { days: 7 },
  })
  const out = giudiziLine(resolveFacts(odd, { tiri: 7 }, []))
  const doc = parseHTML(`<!doctype html><body>${out === null ? '' : render(out)}</body>`).document
  assert.equal(doc.querySelector('.cls--gz dd')!.textContent, '7')
  assert.equal(doc.querySelectorAll('.gz__st').length, 0)
})
