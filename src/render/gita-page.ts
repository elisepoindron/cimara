import { asset } from './assets.ts'
import { gitaForm, type GitaFormOpts } from './gita-form.ts'
import { shell, type Viewer } from './shell.ts'
import { html } from './html.ts'

export interface GitaPageOpts extends GitaFormOpts {
  readonly viewer?: Viewer | null
}

/**
 * The composer as a page. `gitaForm` returns a fragment on purpose — it is the
 * same form wherever it is put, and one day it will be put on the route itself.
 * This is what makes it somewhere a browser can be sent.
 *
 * The heading names the route; the line above it says what this page is. The
 * sheet is signed with the viewer's own name unless the caller said otherwise.
 */
export function gitaPage(opts: GitaPageOpts): string {
  return shell({
    title: 'Nuova relazione',
    viewer: opts.viewer,
    csrf: opts.csrf,
    extraHead: html`<script src="${asset('/words-count.js')}" defer></script>`,
    body: html`<div class="wrap">
  <div class="phead sheet-head">
    <div class="crumb lab"><a href="/itinerario/${opts.itineraryId}">${opts.itineraryName}</a> / Nuova relazione</div>
    <h1>${opts.itineraryName}</h1>
  </div>
  <main class="compose compose--sheet">
    ${gitaForm({ ...opts, author: opts.author ?? opts.viewer?.displayName })}
  </main>
</div>`,
  })
}
