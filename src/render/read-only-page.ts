import { shell } from './shell.ts'
import { html } from './html.ts'
import { brand } from './site.ts'

/**
 * What the public demonstration answers where the archive would take
 * something in — signing up or in, writing a report, starring a route: not an
 * error, a page that says this one is only for reading, and where to go.
 */
export function readOnlyPage(): string {
  return shell({
    title: 'Solo lettura',
    body: html`<div class="wrap">
  <div class="phead"><h1>Solo lettura</h1></div>
  <div class="info__hub ro">
    <p class="info__intro">${brand().name} è una dimostrazione da leggere: qui non si creano account, non si scrivono relazioni e non si salvano preferiti.</p>
    <p>Gli itinerari, le relazioni e le mappe si leggono tutti. <a href="/trova">Torna a Trova</a> o leggi <a href="/info/chi-siamo">che cos'è</a>.</p>
  </div>
</div>`,
  })
}
