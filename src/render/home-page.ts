import { asset } from './assets.ts'
import { homeMap, pinRecap, maplibreHead } from './live-map.ts'
import type { HomeRoute } from '../app/home.ts'
import { shell, type Viewer } from './shell.ts'
import { html, join } from './html.ts'
import { LINE_EXAMPLES, SHOWN_EXAMPLES } from './line-examples.ts'

export interface ActivityCount {
  readonly id: string
  readonly label: string
  readonly n: number
}

export interface HomeOpts {
  readonly activities: readonly ActivityCount[]
  /** A sample of the archive, with nothing asked yet to narrow it. */
  readonly routes: readonly HomeRoute[]
  /** The lines the open line shows in grey, ones this archive answers; by default the first candidates. */
  readonly examples?: readonly string[]
  readonly viewer?: Viewer | null
  readonly csrf?: string
}

/** "6.380" — Italian groups thousands with a full stop. */
const figure = (n: number) => n.toLocaleString('it-IT')

/**
 * Find, before anything has been inferred: one line, and what the archive holds.
 *
 * `home.html` draws the line as a caret over a placeholder, because a drawing
 * cannot be typed into. Here it is a real field, and the button is the form's
 * own submit rather than a link — which is what makes the page work with the
 * keyboard, and with no JavaScript at all.
 */
export function homePage(opts: HomeOpts): string {
  const examples = opts.examples ?? LINE_EXAMPLES.slice(0, SHOWN_EXAMPLES)
  const activities = opts.activities.map(a =>
    html`<li><a href="/trova?q=${encodeURIComponent(a.id)}"
        ><span class="n">${a.label}</span
        ><span class="c">${figure(a.n)} ${a.n === 1 ? 'itinerario' : 'itinerari'}</span></a></li>`)

  return shell({
    title: 'Trova',
    tab: 'trova',
    viewer: opts.viewer,
    csrf: opts.csrf,
    extraHead: maplibreHead(),
    body: html`<div class="split">
  <div class="col">

<section class="q">
  <form method="get" action="/trova">
    <div class="q__row">
      <label class="q__lead" for="q">Cerco</label>
      <div class="q__line" data-examples="${JSON.stringify(examples)}">
        <input class="q__in" id="q" name="q" type="search"
         placeholder="${examples[0] ?? ''}">
      </div>
      <button class="q__end" type="submit" aria-label="Cerca"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="M15.3 15.3 21 21"/></svg></button>
    </div>
  </form>
</section>

  <div class="list">
    <div class="list__h"><b>${String(opts.activities.length)} attività
      <span>nell’archivio</span></b></div>
    <ul class="acts">${join(activities, '\n      ')}</ul>
  </div>

  </div>
  ${homeMap(opts.routes.map(r => ({
    id: r.id, name: r.name, lat: r.lat, lon: r.lon, activity: r.activity,
    recap: pinRecap(r.activity, r.where, r.cells),
  })))}
</div>
<script type="module" src="${asset('/find-live.js')}"></script>
<script type="module" src="${asset('/find-sheet.js')}"></script>`,
  })
}
