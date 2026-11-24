import { asset } from './assets.ts'
import { html, join, type Html } from './html.ts'
import { climbOf, type ProfileSample } from '../domain/profile.ts'

/**
 * A route's elevation profile: a veil, the area under a thin ink line, filled
 * by a continuous ramp and fading towards the ground line, coloured by one of
 * two measures: the path's gradient (`Percorso`, shown first) or the angle of
 * the ground beside it (`Pendio`). Both are measurements, never a verdict on
 * the route; the colours are the slope-angle maps' own.
 *
 * The curve is SVG stretched to the column's width; everything with letters in
 * it (heights, kilometres, names, the reading) is HTML laid over it by
 * percentage, so a phone's narrow column never shrinks the text.
 */

/** The ground's angle, in degrees, to a colour: greys below 30°, then the slope-angle maps' yellow, orange, red and violet. */
const RAMP: readonly (readonly [number, string])[] = [
  [0, '#F1F4F6'], [10, '#DFE6EA'], [20, '#BFCBD2'], [29, '#93A3AD'],
  [30, '#F2CF1B'], [35, '#F08C1E'], [40, '#D7301F'], [45, '#7B3FA0'],
]

/** Where the path's gradient turns yellow; each further colour comes ten points later. */
export const PERCORSO_YELLOW = 25

const rgb = (h: string) => [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16))
const hex = (c: number[]) => '#' + c.map(v => Math.round(v).toString(16).padStart(2, '0')).join('')

/** A position on the ramp, in the ramp's degrees, to its colour, between stops. */
export function tone(v: number): string {
  const x = Math.max(0, Math.min(45, v))
  let i = 0
  while (i < RAMP.length - 2 && x > RAMP[i + 1]![0]) i++
  const [a0, c0] = RAMP[i]!, [a1, c1] = RAMP[i + 1]!
  const k = Math.max(0, Math.min(1, (x - a0) / (a1 - a0)))
  const A = rgb(c0), B = rgb(c1)
  return hex(A.map((q, j) => q + (B[j]! - q) * k))
}

/** The path's gradient on the same ramp: greys up to PERCORSO_YELLOW per cent, then a colour every ten points. Down counts as up. */
export function percorsoPosition(gradePct: number): number {
  const p = Math.abs(gradePct)
  return p < PERCORSO_YELLOW ? p / PERCORSO_YELLOW * 29 : 30 + (p - PERCORSO_YELLOW) / 2
}

/** The key's ticks, in the ramp's degrees, and what each reads under Percorso. */
const TICKS = [0, 15, 30, 35, 40, 45]
const tickPct = (a: number) => a <= 29 ? Math.round(a / 29 * PERCORSO_YELLOW) : PERCORSO_YELLOW + (a - 30) * 2

const W = 1000, H = 300
const STOPS = 120
const fmtKm = (m: number) => (m / 1000).toFixed(1).replace('.', ',')
const pc = (n: number) => `${(Math.round(n * 100) / 100).toString()}%`

export interface ProfileInput {
  readonly sectionId: string
  readonly label: string
  readonly samples: readonly ProfileSample[]
  /** The sheet's climb, printed in the header; absent, the profile's own. */
  readonly climbM?: number | null
  /** Where the route starts, and how high, as the sheet says. */
  readonly start?: { readonly name: string | null; readonly heightM: number | null }
  /** How high the route goes, as the sheet says. */
  readonly topM?: number | null
}

export function profileSection(input: ProfileInput): Html | null {
  const s = input.samples
  if (s.length < 2) return null
  const length = s[s.length - 1]!.d
  if (!(length > 0)) return null
  const lo = Math.min(...s.map(p => p.e)), hi = Math.max(...s.map(p => p.e))
  const step = [50, 100, 200, 250, 500, 1000].find(st => (hi - lo) / st <= 4) ?? 1000
  const eMin = Math.floor(lo / step) * step
  const eMax = Math.max(Math.ceil(hi / step) * step, eMin + step)
  const xs = (d: number) => d / length * W
  const ys = (e: number) => (eMax - e) / (eMax - eMin) * H
  const top = (e: number) => (eMax - e) / (eMax - eMin) * 100
  const left = (d: number) => d / length * 100

  const at = (d: number) => s.reduce((a, p) => Math.abs(p.d - d) < Math.abs(a.d - d) ? p : a)
  const stops = (f: (p: ProfileSample) => number) => join(Array.from({ length: STOPS + 1 }, (_, i) => {
    const p = at(length * i / STOPS)
    return html`<stop offset="${(i / STOPS).toFixed(4)}" stop-color="${tone(f(p))}"/>`
  }), '')
  const line = s.map((p, i) => `${i ? 'L' : 'M'}${xs(p.d).toFixed(1)},${ys(p.e).toFixed(1)}`).join('')
  const area = `${line}L${W},${H}L0,${H}Z`

  const rules: number[] = []
  for (let e = eMin; e <= eMax; e += step) rules.push(e)
  const kmStep = length > 20_000 ? 5000 : length > 8000 ? 2000 : 1000
  const kms: number[] = []
  // A mark too close to the end would sit on the total, which closes the axis.
  for (let d = 0; d <= length - kmStep * 0.65; d += kmStep) kms.push(d)

  const first = s[0]!
  const peak = s.reduce((a, p) => p.e > a.e ? p : a)
  const startName = input.start?.name ?? null
  const startH = input.start?.heightM ?? first.e
  const topH = input.topM ?? peak.e
  const climb = input.climbM ?? climbOf(s)
  const peakRight = left(peak.d) > 70

  const tick = (a: number) => html`<span style="left:${pc(a / 50 * 100)}"><b>${a}°</b><em>${tickPct(a)}%</em></span>`
  const ramp = [...RAMP, [50, '#7B3FA0'] as const].map(([a, c]) => `${c} ${pc(a / 50 * 100)}`).join(',')
  const data = JSON.stringify(s.map(p => [p.d, p.e, p.s, p.g]))

  return html`<section id="${input.sectionId}">
        <h2>${input.label}</h2>
        <div class="pf" data-k="g" data-samples="${data}" data-top="${eMax}" data-bottom="${eMin}">
          <p class="pf__head"><b>${fmtKm(length)} km</b> · ${climb} m di dislivello</p>
          <div class="pf__sw" role="group" aria-label="Colore del profilo" hidden><button type="button" data-k="g" aria-pressed="true">Percorso</button><button type="button" data-k="a" aria-pressed="false">Pendio</button></div>
          <div class="pf__chart">
            <div class="pf__plot">
              ${join(rules.map(e => html`<i class="pf__rule" style="top:${pc(top(e))}"><span>${e}</span></i>`), '')}
              <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" aria-hidden="true">
                <defs>
                  <linearGradient id="pf-g">${stops(p => percorsoPosition(p.g))}</linearGradient>
                  <linearGradient id="pf-a">${stops(p => p.s)}</linearGradient>
                  <linearGradient id="pf-fade" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stop-color="#fff" stop-opacity=".95"/><stop offset="1" stop-color="#fff" stop-opacity=".12"/></linearGradient>
                  <mask id="pf-mask" maskUnits="userSpaceOnUse" x="0" y="0" width="${W}" height="${H}"><rect width="${W}" height="${H}" fill="url(#pf-fade)"/></mask>
                </defs>
                <path class="pf__lay pf__lg" d="${area}" fill="url(#pf-g)" mask="url(#pf-mask)"/>
                <path class="pf__lay pf__la" d="${area}" fill="url(#pf-a)" mask="url(#pf-mask)"/>
                <path class="pf__line" d="${line}" vector-effect="non-scaling-stroke"/>
              </svg>
              <i class="pf__end" style="left:0%;top:${pc(top(first.e))}"></i>
              <i class="pf__end pf__end--top" style="left:${pc(left(peak.d))};top:${pc(top(peak.e))}"></i>
              <span class="pf__name" style="left:0%;top:${pc(top(first.e))}">${startName ? html`${startName} ` : html``}<small>${startH} m</small></span>
              <span class="pf__name pf__name--top${peakRight ? ' is-right' : ''}" style="left:${pc(left(peak.d))};top:${pc(top(peak.e))}"><small>${topH} m</small></span>
              <i class="pf__hair" hidden></i><i class="pf__dot" hidden></i><span class="pf__tip" hidden></span>
            </div>
            <div class="pf__km">${join(kms.map(d => html`<span style="left:${pc(left(d))}">${d === 0 ? '0' : fmtKm(d)}</span>`), '')}<span style="left:100%">${fmtKm(length)} km</span></div>
          </div>
          <div class="pf__scale">
            <p><span class="ka">Pendio del terreno</span><span class="kg">Pendenza del percorso</span></p>
            <i style="background:linear-gradient(90deg,${ramp})"></i>
            <div class="pf__ticks">${join(TICKS.map(tick), '')}</div>
          </div>
          <p class="pf__src">Traccia della scheda; quote e pendii dal modello del terreno (<a href="https://github.com/tilezen/joerd/blob/master/docs/attribution.md" rel="noopener">Terrain Tiles</a>).</p>
        </div>
        <script src="${asset('/profile.js')}" defer></script>
      </section>`
}
