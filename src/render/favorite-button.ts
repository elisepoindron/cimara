import { html, type Html } from './html.ts'
import type { Viewer } from './shell.ts'

export interface FavoriteButtonOpts {
  readonly itineraryId: string
  readonly isFavorite: boolean
  /** Where to send the visitor back to once the form (or the sign-in detour) completes. */
  readonly next: string
  readonly viewer?: Viewer | null
  readonly csrf?: string
}

/** A five-point star, outline or filled by the caller's own `.fav`/`.fav--on` CSS. */
function starIcon(): Html {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2 L15.09 8.26 L22 9.27 L17 14.14 L18.18 21 L12 17.77 L5.82 21 L7 14.14 L2 9.27 L8.91 8.26 Z"/></svg>`
}

/**
 * The favorite star. Shown to everyone — signed out, it is a plain link to sign
 * in that carries `next` back to wherever it was clicked, the same detour
 * `/gita/nuova` already takes. Signed in, it is a real toggle: one of two forms
 * depending on `isFavorite`, the same conditional-form shape
 * `conditions-slot.ts`'s `withdraw()` already uses.
 */
export function favoriteButton(opts: FavoriteButtonOpts): Html {
  if (!opts.viewer || !opts.csrf) {
    return html`<a class="fav" href="/accedi?next=${encodeURIComponent(opts.next)}"
      aria-label="Accedi per aggiungere ai preferiti">${starIcon()}</a>`
  }

  const action = opts.isFavorite
    ? `/preferiti/${opts.itineraryId}/rimuovi`
    : `/preferiti/${opts.itineraryId}`
  const label = opts.isFavorite ? 'Rimuovi dai preferiti' : 'Aggiungi ai preferiti'
  const cls = opts.isFavorite ? 'fav fav--on' : 'fav'

  return html`<form method="post" action="${action}">
    <input type="hidden" name="csrf" value="${opts.csrf}">
    <input type="hidden" name="next" value="${opts.next}">
    <button type="submit" class="${cls}" aria-label="${label}">${starIcon()}</button>
  </form>`
}
