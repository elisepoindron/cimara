import type { FactValue } from '../domain/facts.ts'
import { html, join, type Html } from './html.ts'
import { site } from './site.ts'

/**
 * The crag's star ratings — the facts the registry places in 'giudizi' — as a
 * second line of the header, under the facts strip and in its form: fixed data
 * about the crag, beside the rest of it, never with what the reports say
 * (giudizi-placement-options.html, D). The line has no visible title, a hairline
 * sets it apart; its accessible name says what it is.
 *
 * Five glyphs per cell, the earned ones in ink and the rest pale: never red,
 * which is this page's warning colour. A cell's accessible name is the rating
 * in words ("4 su 5"), so the glyphs are never the only way to read it. A
 * rating nobody gave reads as the dash the registry resolves it to, and the
 * line stays: an all-dash line says nobody has rated this crag, which is worth
 * saying — except on the public demonstration, which never invents a rating,
 * so that every crag's line would be dashes and say nothing about any of them.
 */
export function giudiziLine(values: readonly FactValue[]): Html | null {
  const rated = values.filter(v => v.def.placement === 'giudizi')
  if (rated.length === 0) return null
  if (site().demo && rated.every(v => v.value === null)) return null

  const cells = rated.map(v => html`<div${v.value === null ? html` class="nil"` : html``}><dt>${v.def.label.it}</dt><dd>${
    v.def.quantity.kind === 'stars' && typeof v.value === 'number' ? stars(v.value, v.text) : v.text}</dd></div>`)

  return html`<dl class="cls cls--gz" aria-label="Giudizi">${join(cells, '\n      ')}</dl>`
}

function stars(n: number, words: string): Html {
  return html`<span class="gz__st" role="img" aria-label="${words}"><span class="on">${'★'.repeat(n)}</span>${'★'.repeat(5 - n)}</span>`
}
