import { shell } from './shell.ts'
import { html } from './html.ts'
import { brand } from './site.ts'

/**
 * What the public demonstration answers when its budget for reports or photos
 * is spent for now: not an error, a page that says so and when to come back.
 */
export function demoBusyPage(): string {
  return shell({
    title: 'Riprova più tardi',
    body: html`<div class="wrap">
  <div class="phead"><h1>Riprova più tardi</h1></div>
  <div class="info__hub ro">
    <p class="info__intro">${brand().name} è una dimostrazione, e per ora sono arrivate abbastanza relazioni e foto: niente è stato salvato.</p>
    <p>Riprova fra un po'. Intanto <a href="/trova">torna a Trova</a>.</p>
  </div>
</div>`,
  })
}
