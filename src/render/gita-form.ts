import type { ActivitySchema } from '../domain/registry.ts'
import { html, join, type Html } from './html.ts'
import { problemsList } from './problems.ts'
import { extFor } from '../app/photo-store.ts'
import type { PendingPhotoRow } from '../db/pending-photo.ts'

/**
 * A report is rendered in full inside a `position:sticky` rail, so an unbounded
 * one makes the rail taller than the viewport. The cap is exported because the
 * route enforces the same number server-side: `maxlength` is a courtesy to an
 * honest browser, never a control.
 */
export const WORDS_MAX = 4000

/**
 * Caption length cap for each photo. Exported because the route enforces it
 * server-side.
 */
export const CAPTION_MAX = 200

export interface GitaFormOpts {
  readonly schema: ActivitySchema
  readonly itineraryId: string
  readonly itineraryName: string
  readonly csrf: string
  /** ISO day, the date box's default when nothing was typed. */
  readonly today: string
  /** The pending photos screen 1 handed off — never more figures than this. */
  readonly photos: readonly PendingPhotoRow[]
  /** The name the relazione will be signed with, said in the sheet's foot. */
  readonly author?: string
  /** What a failed submission had in it, keyed by field name. */
  readonly values?: Map<string, string>
  readonly problems?: readonly string[]
}

/**
 * The composer: the day, the words, the photos. Nothing asks a climber to rate
 * anything or to measure anything — what they found is in what they write, and
 * the placeholder suggests what is worth saying without making it a field. The
 * same form for every activity.
 *
 * With two questions left it is laid out as a sheet to write on rather than a
 * stack of fields: the day is a sentence in the sheet's head, the words take
 * the whole width with no box of their own, the photos sit under them, and the
 * foot says who signs it and holds the one action. The words' label is kept
 * for a screen reader and hidden from sight, where the placeholder already
 * says what to write.
 */
export function gitaForm(opts: GitaFormOpts): Html {
  const typed = (field: string) => opts.values?.get(field) ?? ''

  return html`<form class="gita sheet" method="post" action="/gita" novalidate>
  <input type="hidden" name="csrf" value="${opts.csrf}">
  <input type="hidden" name="itinerario" value="${opts.itineraryId}">
  <input type="hidden" name="foto_ids" value="${opts.photos.map(p => p.id).join(',')}">
  ${opts.problems && opts.problems.length > 0 ? html`<div class="sheet__problems">${problemsList(opts.problems)}</div>` : null}
  <p class="sheet__hd">
    <label for="gita-quando">La tua gita a <b>${opts.itineraryName}</b> è del</label>
    <input id="gita-quando" type="date" name="quando" value="${opts.values?.get('quando') ?? opts.today}">
  </p>
  <p class="sheet__page">
    <label class="sr" for="gita-parole">Com’è andata</label>
    <textarea id="gita-parole" name="parole" rows="12" maxlength="${WORDS_MAX}" data-count="gita-conta" placeholder="Com’era la roccia o la neve, l’avvicinamento, chi c’era, cosa ti ha sorpreso…">${typed('parole')}</textarea>
  </p>
  ${photoFigures(opts.photos, opts)}
  <div class="sheet__ft">
    <p>${opts.author ? html`Firmata <b>${opts.author}</b> · puoi` : html`Puoi`} ritirarla quando vuoi<span class="sheet__n" id="gita-conta" hidden></span></p>
    <button type="submit">Pubblica la relazione</button>
  </div>
</form>`
}

/**
 * One figure per photo screen 1 actually handed off — never a fixed grid of
 * empty slots. `Includi questa foto N`, checked by default, is what a
 * multi-select picker needs that six independent slots never did: a way to
 * change your mind about one photo without re-picking the whole batch. On a
 * fresh render every box defaults to checked (`opts.values` is absent
 * entirely); on a failed publish, a box is checked only if its own
 * `incl_<id>` key survived into `opts.values` — an unchecked box submits no
 * field at all, so its absence *is* "unchecked," the one native HTML
 * behaviour this flow otherwise avoids relying on.
 */
function photoFigures(photos: readonly PendingPhotoRow[], opts: GitaFormOpts): Html | null {
  if (photos.length === 0) return null

  const typed = (field: string) => opts.values?.get(field) ?? ''
  const included = (id: string) => opts.values ? opts.values.has(`incl_${id}`) : true

  // Numbered 1-based by position in `photos` — the same "Foto N" `fileFromForm`
  // names a problem by, since `opts.photos` arrives in `foto_ids` order per
  // livePendingPhotos's own contract. This number is positional within
  // whatever set is currently being shown, not a stable id-based number: on a
  // failed publish's re-render, `livePendingPhotos` silently drops any id that
  // has since expired, so in the narrow window where a photo expires between
  // that failure and this re-render, the same visible number can point at a
  // different photo than the one a stale problem message named. Accepted, not
  // solved here — see the plan's own note on this edge case.
  const figures = photos.map((p, i) => {
    const n = i + 1
    return html`<p class="gita__foto">
    <img src="/foto/pending/${p.id}.${extFor(p.mime)}" alt="Foto ${n}">
    <input type="text" name="didascalia_${p.id}" value="${typed('didascalia_' + p.id)}"
           maxlength="${CAPTION_MAX}" placeholder="Didascalia (facoltativa)">
    <label class="incl"><input type="checkbox" name="incl_${p.id}"${included(p.id) ? html` checked` : null}> Includi questa foto ${n}</label>
  </p>`
  })
  return html`<div class="sheet__photos">
    <span class="lab">Foto</span>
    <div class="sheet__grid">
  ${join(figures, '\n  ')}
    </div>
  </div>`
}

