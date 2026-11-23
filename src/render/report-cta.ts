import { html, type Html } from './html.ts'

function bubbleIcon(): Html {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="4" width="18" height="13" rx="2.5" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="M8 17l-1 4 4.5-4Z" fill="currentColor"/></svg>`
}

/**
 * A speech bubble, the same size as the favorite star beside it — "racconta"
 * is to tell, and the bubble says that before the label does, without reading
 * as an edit control the way a pencil would. The one, unconditional way in to
 * filing a report, next to the title rather than folded into whichever
 * condition state happens to be showing. `/gita/nuova` detours a signed-out
 * visitor to sign in by itself, the way `favoriteButton`'s link does, so this
 * needs no viewer or csrf to decide anything.
 */
export function reportCta(itineraryId: string): Html {
  return html`<a class="file" href="/gita/nuova?itinerario=${itineraryId}" aria-label="Racconta la tua gita">${bubbleIcon()}</a>`
}
