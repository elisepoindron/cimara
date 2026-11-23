import type { ActivitySchema } from '../domain/registry.ts'
import { gradeSpreadOf, type Part } from '../domain/facts.ts'
import { plural } from '../domain/italian.ts'
import { gradeBandAttr } from './grade-band.ts'
import { sportGradeBand } from '../domain/quantity.ts'
import { concat, html, join, type Html } from './html.ts'

// Recovered from crag.html. Changing any of these changes the drawing.
const WIDTH = 640
const BASELINE = 158
const FULL_BAR = 118
const GAP = 8
const RADIUS = 4
const COUNT_ABOVE = 7
const LABEL_Y = 176
// How many vie a full-height bar stands for, on every crag, so one via is a short bar
// rather than the top of the chart. A crag with more in one grade is drawn to its own.
const FULL_COUNT = 10

const n1 = (v: number) => v.toFixed(1)

/**
 * The grade distribution, computed from the vie rather than stored. This is the
 * claim the case study makes about the crag page, drawn.
 */
export function gradeHistogram(
  schema: ActivitySchema,
  parts: readonly Part[],
  fieldId: string,
): Html | null {
  const spread = gradeSpreadOf(schema, parts, fieldId)
  if (spread.length === 0) return null

  // gradeSpreadOf already threw if schema.parts were undefined, so it is
  // guaranteed here — the `?? 'via'/'vie'` this project used to fall back to
  // was unreachable, and read as a handled case that never happened.
  const partsDef = schema.parts!
  const each = partsDef.each.it
  const many = partsDef.label.it.toLowerCase()
  // Not parts.length: gradeSpreadOf silently drops a part whose grade fails
  // to parse, so the bars must sum to the same total the caption states.
  const total = spread.reduce((sum, s) => sum + s.n, 0)
  const tallest = Math.max(FULL_COUNT, ...spread.map(s => s.n))
  const barW = (WIDTH - GAP * (spread.length - 1)) / spread.length

  const most = Math.max(...spread.map(s => s.n))
  const bars = spread.map((step, i) => {
    const x = i * (barW + GAP)
    const top = BASELINE - (FULL_BAR * step.n) / tallest
    const mid = x + barW / 2
    const d = `M${n1(x)},${BASELINE} L${n1(x)},${n1(top + RADIUS)}`
            + ` Q${n1(x)},${n1(top)} ${n1(x + RADIUS)},${n1(top)}`
            + ` L${n1(x + barW - RADIUS)},${n1(top)}`
            + ` Q${n1(x + barW)},${n1(top)} ${n1(x + barW)},${n1(top + RADIUS)}`
            + ` L${n1(x + barW)},${BASELINE} Z`

    // The tallest step says its count without being pointed at (app.css: the chart, form B).
    const peak = step.n > 0 && step.n === most

    // An empty step keeps its place and its label, and draws nothing above the axis.
    return concat(
      html`<g class="${peak ? 'bar peak' : 'bar'}"${gradeBandAttr(step.value)}><title>${step.value}: ${plural(step.n, each, many)} su ${total}</title>`,
      step.n > 0
        ? concat(
            html`<path d="${d}"/>`,
            html`<text class="n" x="${n1(mid)}" y="${n1(top - COUNT_ABOVE)}">${step.n}</text>`)
        : html``,
      html`<text class="g" x="${n1(mid)}" y="${LABEL_Y}">${step.value}</text>`,
      html`</g>`)
  })

  // Read aloud, the empty columns are noise: the grades that have vie say the shape.
  const described = spread.filter(s => s.n > 0).map(s => `${s.value} ${plural(s.n, each, many)}`).join(', ')

  // A 9's count is written in a rainbow that slides, as its grade is in the list beside it.
  // app.css points the count at this gradient; it is only drawn where a 9 is.
  const nineInk = spread.some(s => sportGradeBand(s.value) === 9)
    ? html`<defs><linearGradient id="grade-nine-ink" x1="0" x2="1" y1="0" y2="0" spreadMethod="repeat">
      <stop offset="0" stop-color="#E0117F"/><stop offset=".17" stop-color="#E07000"/><stop offset=".33" stop-color="#C9A800"/>
      <stop offset=".5" stop-color="#13B86A"/><stop offset=".67" stop-color="#0098D6"/><stop offset=".83" stop-color="#6A3DF0"/>
      <stop offset="1" stop-color="#E0117F"/>
      <animateTransform attributeName="gradientTransform" type="translate" from="0 0" to="1 0" dur="7s" repeatCount="indefinite"/>
    </linearGradient></defs>`
    : html``

  return html`<div class="chart-wrap"><svg viewBox="0 0 ${WIDTH} 200" class="chart" role="img"
    aria-label="Ripartizione dei gradi: ${described}"
    >${nineInk}<line class="axis" x1="0" y1="${BASELINE}" x2="${WIDTH}" y2="${BASELINE}"/>${join(bars, '')}</svg></div>`
}
