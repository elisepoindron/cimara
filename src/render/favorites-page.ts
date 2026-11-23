import { shell, type Viewer } from './shell.ts'
import { favoriteButton } from './favorite-button.ts'
import { html, join, type Html } from './html.ts'
import type { FavoriteRow } from '../app/favorites.ts'
import { axisOf, type GradeAxis } from '../domain/row-facts.ts'
import { factsLine, iconSprite } from './facts-line.ts'

export interface FavoritesPageOpts {
  readonly rows: readonly FavoriteRow[]
  readonly viewer?: Viewer | null
  readonly csrf?: string
}

function row(r: FavoriteRow, axis: GradeAxis | null, opts: FavoritesPageOpts): Html {
  // `r--plain`: no reports column, so no star column beside one either. The
  // facts line is unaligned — Preferiti mixes activities, so a column would
  // hold a route's grade in one row and a crag's histogram in the next.
  return html`<div class="r r--plain">
      <div class="r__bar" style="background:var(--rule)"></div>
      <div><p class="r__n"><a class="r__link" href="/itinerario/${r.id}">${r.name}</a><small>${r.where}</small></p>
        ${factsLine(r.cells, axis, { aligned: false })}</div>
      ${favoriteButton({
        itineraryId: r.id, isFavorite: true, next: '/preferiti',
        viewer: opts.viewer, csrf: opts.csrf,
      })}
    </div>`
}

/**
 * Everything a signed-in visitor has starred, most recently starred first — no
 * sentence, no search box, no map. Search over favorites is deliberately out of
 * scope until there is a list worth searching.
 */
export function favoritesPage(opts: FavoritesPageOpts): string {
  const axis = axisOf(opts.rows.map(r => r.cells))
  return shell({
    title: 'Preferiti',
    tab: 'preferiti',
    viewer: opts.viewer,
    csrf: opts.csrf,
    body: html`<div class="wrap">
  <div class="phead"><h1>Preferiti</h1></div>
  <div class="list">
    ${opts.rows.length === 0
      ? html`<p class="empty">Nessun preferito ancora. <a href="/trova">Torna a Trova</a>.</p>`
      : html`${iconSprite()}
    ${join(opts.rows.map(r => row(r, axis, opts)), '\n    ')}`}
  </div>
</div>`,
  })
}
