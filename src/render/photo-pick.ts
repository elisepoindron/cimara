import { shell, type Viewer } from './shell.ts'
import { html } from './html.ts'
import { problemsList } from './problems.ts'
import { PHOTOS_MAX } from '../app/gite.ts'

export interface PhotoPickPageOpts {
  readonly itineraryId: string
  readonly itineraryName: string
  readonly csrf: string
  readonly viewer?: Viewer | null
  readonly problems?: readonly string[]
}

/**
 * Screen 1 of the two-screen photo flow: pick, then caption. One native
 * multi-select field, not six fixed slots — what comes back decides how
 * many caption boxes screen 2 shows, never more than were actually chosen.
 * Skipping photos entirely is a plain link to screen 2 carrying `foto=`
 * (present, empty) rather than the picker forcing a detour through it.
 */
export function photoPickPage(opts: PhotoPickPageOpts): string {
  return shell({
    title: 'Nuova relazione',
    viewer: opts.viewer,
    csrf: opts.csrf,
    body: html`<div class="wrap">
  <div class="phead sheet-head">
    <div class="crumb lab"><a href="/itinerario/${opts.itineraryId}">${opts.itineraryName}</a> / Nuova relazione</div>
    <h1>${opts.itineraryName}</h1>
  </div>
  <main class="compose compose--sheet">
    <form class="gita sheet" method="post" action="/gita/foto" enctype="multipart/form-data" novalidate>
      <input type="hidden" name="csrf" value="${opts.csrf}">
      <input type="hidden" name="itinerario" value="${opts.itineraryId}">
      ${opts.problems && opts.problems.length > 0 ? html`<div class="sheet__problems">${problemsList(opts.problems)}</div>` : null}
      <p class="sheet__hd"><span>Racconta la tua gita a <b>${opts.itineraryName}</b>. Prima le foto, se ne hai.</span></p>
      <p class="sheet__pick">
        <label for="gita-foto">Scegli le foto</label>
        <input id="gita-foto" type="file" name="foto" multiple accept="image/jpeg,image/png">
        <small>Fino a ${PHOTOS_MAX}, in JPEG o PNG. Le didascalie si scrivono dopo.</small>
      </p>
      <div class="sheet__ft">
        <p class="gita__skip"><a href="/gita/nuova?itinerario=${opts.itineraryId}&foto=">Continua senza foto</a></p>
        <button type="submit">Continua</button>
      </div>
    </form>
  </main>
</div>`,
  })
}
