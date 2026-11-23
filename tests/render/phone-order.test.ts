import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'

/**
 * The phone orders a page's cards with CSS `order`, one rule per section id,
 * and a later rule wins. The description opens the second tab, before what is
 * drawn from the route's data, so a crag's grade chart and list of routes stay
 * adjacent, one card.
 */
const css = await readFile(new URL('../../public/app.css', import.meta.url), 'utf8')

/** The order the last `.l3 #<id>` rule that sets one gives. */
function orderOf(id: string): number {
  const re = new RegExp(`\\.l3 #${id}(?![\\w-])[^{]*\\{order:(\\d+)\\}`, 'g')
  const found = [...css.matchAll(re)]
  assert.ok(found.length > 0, `no phone order for #${id}`)
  return Number(found.at(-1)![1])
}

test('on a phone the description comes before the grade chart and the profile', () => {
  assert.ok(orderOf('descrizione') < orderOf('gradi'))
  assert.ok(orderOf('descrizione') < orderOf('profilo'))
})

test('on a phone the description never lands between the grade chart and the list of routes', () => {
  const [d, gradi, settori] = [orderOf('descrizione'), orderOf('gradi'), orderOf('settori')]
  assert.ok(d < gradi || d > settori, `#descrizione at ${d} splits the chart (${gradi}) from the list (${settori})`)
})
