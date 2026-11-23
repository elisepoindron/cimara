import type { ActivitySchema } from '../domain/registry.ts'
import { ABSENT, type Part } from '../domain/facts.ts'
import { gradeBandAttr } from './grade-band.ts'
import { html, join, type Html } from './html.ts'

/**
 * A route's pitches, in the order they are climbed (pitch-list-options.html,
 * A with D's left columns): the pitch, its grade and its length on the left,
 * where the eye runs down them, then its words in full. A pitch graded between
 * two reads "6b+/6c" and is coloured by the lower. Nothing recorded reads as a
 * dash, never a blank a reader could take for "none".
 */
export function pitchList(schema: ActivitySchema, parts: readonly Part[]): Html | null {
  if (!schema.parts || parts.length === 0) return null
  const ordered = [...parts].sort((a, b) => a.position - b.position)
  return html`<ol class="tiri">${join(ordered.map((p, i) => pitch(p, i + 1)), '')}</ol>`
}

function pitch(part: Part, n: number): Html {
  const grade = str(part.fields.grado)
  const upper = str(part.fields.grado_fino)
  const length = typeof part.fields.lunghezza === 'number' ? `${part.fields.lunghezza} m` : null
  const words = str(part.fields.descrizione)
  const shown = grade ? (upper ? `${grade}/${upper}` : grade) : null
  return html`<li><span class="tiri__n">L${n}</span>${shown
    ? html`<em${gradeBandAttr(grade!)}>${shown}</em>`
    : html`<em class="nil">${ABSENT}</em>`}<b${length ? html`` : html` class="nil"`}>${length ?? ABSENT}</b><p>${words ?? ''}</p></li>`
}

const str = (v: unknown): string | null => (typeof v === 'string' && v.trim() !== '' ? v.trim() : null)
