import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { homePage } from '../../src/render/home-page.ts'

const page = () => parseHTML(homePage({ activities: [], routes: [] })).document

test('Cerca ends the sentence: the submit sits on the line\'s own row, after the line', () => {
  const doc = page()
  const row = doc.querySelector('form .q__row')
  assert.ok(row, 'the question has its row')
  const children = [...row.children].map(c => c.className)
  assert.deepEqual(children, ['q__lead', 'q__line', 'q__end'])
  assert.equal(doc.querySelectorAll('.q__go').length, 0, 'no button left floating under the line')
})

test('the lens is the form\'s own submit and is named for screen readers', () => {
  const doc = page()
  const buttons = doc.querySelectorAll('form button')
  assert.equal(buttons.length, 1)
  assert.equal(buttons[0]!.getAttribute('type'), 'submit')
  assert.equal(buttons[0]!.getAttribute('aria-label'), 'Cerca')
  assert.equal(buttons[0]!.querySelector('svg')?.getAttribute('aria-hidden'), 'true')
})
