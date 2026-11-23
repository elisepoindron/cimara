import { html, type Html } from './html.ts'

/**
 * The problems a failed attempt reported, as a plain list.
 *
 * Each one goes through `html`, so a message that happens to carry markup —
 * nothing validates what a problem message contains — arrives as text rather
 * than as tags.
 *
 * Shared because it is now on three forms. It was written twice on purpose,
 * when the second caller was a task that did not own the first one's file; the
 * third is where copying stops being cheaper than sharing.
 */
export function problemsList(problems: readonly string[] | undefined): Html | null {
  if (!problems || problems.length === 0) return null
  return html`<ul class="problems">${problems.map(p => html`<li>${p}</li>`)}</ul>`
}
