import { ABSENT, type FactValue } from '../domain/facts.ts'
import { html, type Html } from './html.ts'

/**
 * The way there, in words: always the same three rows, in the same order, a
 * dash where nothing is recorded — so every page's panel has one shape, however
 * much its source wrote down.
 * The labels are the panel's own, not the facts': the panel is titled Come
 * arrivare, so the road is `Strada`, and the parking note sits under the
 * parking point as `Note sul parcheggio`, a row like the others, not an alert.
 */
export function roadRows(access: readonly FactValue[]): Html {
  const textOf = (id: string) => {
    const v = access.find(f => f.def.id === id)
    return v && v.value !== null && v.text !== '' ? v.text : null
  }
  const come = textOf('come_arrivare')
  const torino = textOf('da_torino')
  const strada = come && torino ? `${come} Da Torino: ${torino}` : come ?? (torino ? `Da Torino: ${torino}` : null)

  const row = (label: string, text: string | null) =>
    html`<div><dt>${label}</dt><dd${text === null ? html` class="nil"` : html``}>${text ?? ABSENT}</dd></div>`

  return html`<dl class="dl pk__road">${row('Partenza', textOf('localita_partenza'))}
          ${row('Strada', strada)}
          ${row('Note sul parcheggio', textOf('parcheggio_nota'))}</dl>`
}

/**
 * The panel with no points to name: an activity that records no parking spot,
 * or an alpine route whose spot nobody recorded. Still drawn, in the same place
 * and under the same title, so the road is never somewhere else on the page.
 */
export function roadPanel(opts: { sectionId: string; label: string }, road: Html): Html {
  return html`<section id="${opts.sectionId}">
        <h2>${opts.label}</h2>
        ${road}
      </section>`
}
