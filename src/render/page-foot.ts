import { html, join, type Html } from './html.ts'
import { formatDate, yearOf } from '../domain/italian.ts'
import type { PageCredits } from '../db/credits.ts'
import { brand } from './site.ts'

function pencilIcon(): Html {
  return html`<svg viewBox="0 0 24 24" aria-hidden="true"><path fill="currentColor" d="M3 17.25V21h3.75L17.8 9.94l-3.75-3.75L3 17.25zm17.7-10.2a1 1 0 0 0 0-1.42l-2.33-2.33a1 1 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.83-1.83z"/></svg>`
}

/**
 * The page's own colophon, under both columns: one quiet line about the
 * description, never about the conditions.
 * When it was last revised and who wrote it, on the left, each only where the
 * archive records it — an importer never invents either; and on the right the
 * way to propose a change, always, as a mail whose subject names the route so
 * the editors know which page it is about.
 */
export function pageFoot(name: string, credits: PageCredits = { revised: null, authors: [] }): Html {
  const to = brand().contact
  const said = [
    credits.revised ? html`<span><span class="pfoot__k">Ultima revisione</span> ${formatDate(credits.revised)} ${yearOf(credits.revised)}</span>` : null,
    credits.authors.length ? html`<span><span class="pfoot__k">Autori</span> ${join(credits.authors.map(a => html`<b>${a}</b>`), ', ')}</span>` : null,
  ].filter((x): x is Html => x !== null)
  // A deploy with nobody to write to (the public demonstration) offers no way to propose a change.
  const edit = to
    ? html`<span class="pfoot__edit">${pencilIcon()}<a href="${`mailto:${to}?subject=${encodeURIComponent(`Modifica: ${name}`)}`}">Proponi una modifica alla scheda</a></span>`
    : html``
  if (!said.length && !to) return html``
  return html`<footer class="pfoot">${said.length ? html`<p class="pfoot__by">${join(said, ' · ')}</p>` : html``}${edit}</footer>`
}
