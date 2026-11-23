import type { RowIcon } from '../domain/registry.ts'
import { barsOn, type GradeAxis, type RowCell, type RowSlot } from '../domain/row-facts.ts'
import type { Aspect } from '../domain/quantity.ts'
import { gradeBandAttr } from './grade-band.ts'
import { html, join, raw, type Html } from './html.ts'

/**
 * The six icons, as the design draws them. Copied from the symbols in
 * the find-falesia mockup, and a private acceptance test holds the
 * two equal. Constant markup, which is the only reason raw is used for it.
 */
export const ICON_SYMBOLS: Record<RowIcon, string> = {
  vie: '<ellipse cx="12" cy="5.2" rx="2.9" ry="3.9"/><path d="M10.6 8.8h2.8v6.4h-2.8z"/><ellipse cx="12" cy="18.8" rx="2.9" ry="3.9"/>',
  esp: '<circle cx="12" cy="12" r="9.5"/><path d="M12 1.2v2.6"/>',
  avv: '<circle cx="13" cy="3.6" r="1.9" fill="currentColor" stroke="none"/><path d="M12.4 7l-1.4 6.5-3 7.5M11 13.5l3.6 3.2.9 4.3M12.1 8.6l3.3 3M12.1 8.6l-3.2 2.9"/>',
  grado: '<path d="M4.5 20.5v-4M9.5 20.5v-8M14.5 20.5V8.5M19.5 20.5V3.5"/>',
  dplus: '<path d="M7 21l6-11 3 5 2-3 4.5 9zM3.5 18V4M1 6.5 3.5 4 6 6.5"/>',
  km: '<path d="M6 13.5C3.8 10.8 2.5 9 2.5 7.2a3.5 3.5 0 0 1 7 0c0 1.8-1.3 3.6-3.5 6.3z"/><path d="M8 17.5h8" stroke-dasharray="2 2.2"/><circle cx="19.5" cy="17.5" r="2" fill="currentColor" stroke="none"/>',
}

/** Every icon, declared once per page and drawn with use wherever a row needs it. */
export function iconSprite(): Html {
  const symbols = Object.entries(ICON_SYMBOLS)
    .map(([id, body]) => `<symbol id="i-${id}" viewBox="0 0 24 24">${body}</symbol>`)
  return raw(`<svg class="icons" aria-hidden="true"><defs>\n  ${symbols.join('\n  ')}\n</defs></svg>`)
}

/** Clockwise from north: where the compass needle points for each aspect. */
const DEGREES: Record<Aspect, number> = { N: 0, NE: 45, E: 90, SE: 135, S: 180, SO: 225, O: 270, NO: 315 }

/**
 * An icon that names itself, as a tooltip and to a screen reader, because it
 * stands where a written label used to. The compass also draws its value.
 */
function icon(id: RowIcon, name: string, aspect: Aspect | null = null): Html {
  if (aspect === null) {
    return html`<svg class="ic" role="img" aria-label="${name}"><title>${name}</title><use href="#i-${id}"/></svg>`
  }
  return html`<svg class="ic" viewBox="0 0 24 24" role="img" aria-label="${name}"><title>${name}</title><use href="#i-${id}"/><path d="M12 4.6l3 8.4h-6z" fill="currentColor" stroke="none" transform="rotate(${DEGREES[aspect]} 12 12)"/></svg>`
}

export const HISTOGRAM_WIDTH = 134
const GAP = 2
const BAR_HEIGHT = 20
const n1 = (v: number) => String(+v.toFixed(1))

/**
 * Where a crag's vie sit on the grade scale. Always the same width, so the
 * column never changes shape from one search to the next; the bars share it
 * across the list's axis. Heights are within the row — the Vie count beside it
 * says how many.
 */
function gradeBars(cell: Extract<RowCell, { kind: 'histogram' }>, axis: GradeAxis): Html {
  const step = (HISTOGRAM_WIDTH + GAP) / axis.grades.length
  const width = step - GAP
  const counted = barsOn(cell, axis)
  const tallest = Math.max(...counted.map(c => c.n))
  const vie = (n: number) => `${n} ${n === 1 ? cell.each : cell.many}`
  const label = `Gradi: ${vie(cell.total)} dal ${cell.counts[0]!.grade} al ${cell.counts.at(-1)!.grade}`

  const bars = counted.map(c => {
    const h = Math.max(2, Math.round(c.n / tallest * BAR_HEIGHT))
    return html`<rect${gradeBandAttr(c.grade)} x="${n1(c.at * step)}" y="${BAR_HEIGHT - h}" width="${n1(width)}" height="${h}" rx="1"><title>${c.grade}: ${vie(c.n)}</title></rect>`
  })
  const ticks = axis.grades.flatMap((g, i) => /^\da$/.test(g)
    ? [html`<text x="${n1(i * step + width / 2)}" y="${BAR_HEIGHT + 10}">${g}</text>`]
    : [])

  const tall = BAR_HEIGHT + 12
  return html`<svg class="gh" width="${HISTOGRAM_WIDTH}" height="${tall}" viewBox="0 0 ${HISTOGRAM_WIDTH} ${tall}" role="img" aria-label="${label}"><title>${label}</title><line x1="0" y1="${BAR_HEIGHT + 0.5}" x2="${HISTOGRAM_WIDTH}" y2="${BAR_HEIGHT + 0.5}"/>${join(bars)}${join(ticks)}</svg>`
}

function cellOf(slot: RowSlot, axis: GradeAxis | null): Html {
  if (slot === null) return html`<div></div>`
  switch (slot.kind) {
    case 'histogram':
      return axis ? html`<div><dd>${gradeBars(slot, axis)}</dd></div>` : html`<div></div>`
    case 'fact':
      return html`<div><dt>${icon(slot.icon, slot.label, slot.aspect)}</dt><dd>${slot.text}</dd></div>`
    case 'distance':
      return html`<div><dt>${icon('km', 'Distanza')}</dt><dd>${slot.km.toFixed(0)} km</dd></div>`
    case 'grades':
      return html`<div><dt>${icon('grado', slot.label)}</dt><dd class="r__g">${join(slot.grades.map(g =>
        html`<span><small>${g.it}</small> <em${gradeBandAttr(g.grade)}>${g.grade}</em></span>`), ' ')}</dd></div>`
  }
}

/**
 * A row's facts, an icon and a value each. `aligned` is for a Find list of one
 * activity, where app.css places each fact in its column by position: an
 * empty slot is kept so the next fact stays in its own column. Unaligned, it
 * is left out, so the gaps between the rest stay even.
 */
export function factsLine(slots: readonly RowSlot[], axis: GradeAxis | null, opts: { aligned: boolean }): Html {
  if (slots.every(s => s === null)) return html``
  const kept = opts.aligned ? slots : slots.filter(s => s !== null)
  return html`<dl class="r__f">${join(kept.map(s => cellOf(s, axis)))}</dl>`
}
