import type { FactValue } from '../domain/facts.ts'
import { html, join, type Html } from './html.ts'

/** A warning triangle, drawn before a value that is one (rockfall: Sì). */
const WARN = html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 3 2 21h20Z"/><path d="M12 10v5M12 17.6v.4"/></svg>`

/**
 * The strip of figures across the top of the page. Generated from the registry,
 * never typed: `route.html` shows six for an alpine route, `crag.html` its own,
 * and this is the same function. Facts placed elsewhere (the crag's ratings,
 * on the line under it, giudizi.ts) are left out here rather than by every caller.
 */
export function factsStrip(values: readonly FactValue[]): Html {
  const cells = values
    .filter(v => (v.def.placement ?? 'strip') === 'strip')
    .map(v => v.def.warnIf !== undefined && v.value === v.def.warnIf
      ? html`<div><dt>${v.def.label.it}</dt><dd class="warn">${WARN}${v.text}</dd></div>`
      // A fact nobody recorded is marked, so a phone can leave it out where a
      // desktop strip keeps its dash (mobile-options.html, fixes).
      : v.value === null
        ? html`<div class="nil"><dt>${v.def.label.it}</dt><dd>${v.text}</dd></div>`
        : html`<div><dt>${v.def.label.it}</dt><dd>${v.text}</dd></div>`)

  return html`<dl class="cls">${join(cells, '\n      ')}</dl>`
}
