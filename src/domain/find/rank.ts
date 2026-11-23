import { distanceM } from '../geo.ts'
import type { Constraint, GradeSystem } from './constraints.ts'

export interface Candidate {
  readonly id: string
  readonly name: string
  readonly lat: number | null
  readonly lon: number | null
  readonly gradeMin: number | null
  readonly gradeMax: number | null
  /** Which scale those ordinals are on. Without it they are integers about nothing. */
  readonly gradeScale: GradeSystem | null
  /** Standing reports of any age: what "leggi tutte le N relazioni" counts. */
  readonly reports: number
  /** Standing reports inside the activity's own window, which is what "recent" means. */
  readonly recent: number
  readonly lastReportAt: string | null
}

export interface RankOpts {
  readonly now: Date
  /**
   * Where a `near` constraint's place actually is. The parser reads "da Torino"
   * off the line and cannot know where Torino is — only that the archive holds a
   * place by that name — so the caller resolves it and passes it through here.
   */
  readonly centre?: { readonly lat: number; readonly lon: number } | null
}

export interface Ranked {
  readonly candidate: Candidate
  readonly score: number
  /** Italian, and the only part of the arithmetic a climber ever sees. */
  readonly why: string
}

/**
 * What each contribution is worth, all on the same nought-to-one scale so they
 * can be summed and, more importantly, compared: the reason names whichever
 * contributed most, and that comparison is only meaningful in shared units.
 */
const WEIGHT = {
  reports: 1,
  distance: 1.2,   // asked for explicitly, so it outweighs what was not asked for
  grade: 1,
  recency: 0.6,
} as const

/**
 * Recent reports are worth more than none, and several more than one, up to
 * three: past that, more people saying what they found adds reading, not rank.
 * Nothing here knows what they found. A route is never ranked up for having
 * been called good, because nothing calls a route good any more.
 */
const ENOUGH_RECENT = 3

const DAY = 24 * 60 * 60 * 1000

/** Halves every seven days. One today is worth two a week ago. */
function recency(lastReportAt: string | null, now: Date): number {
  if (!lastReportAt) return 0
  const days = (now.getTime() - Date.parse(`${lastReportAt}T12:00:00.000Z`)) / DAY
  return days < 0 ? 1 : Math.pow(0.5, days / 7)
}

/**
 * How far inside the asked-for range a route sits: one when it overlaps at all,
 * falling by a fifth per step beyond it, nought once it is five steps out.
 *
 * Null where the question cannot be asked — the route declares no grade, or
 * declares one on the other scale. A sport constraint against an alpine route is
 * not a route that scores badly; it is a comparison that means nothing, and
 * scoring it nought would rank it below routes it was never measured against.
 */
function gradeFit(c: Candidate, min: number, max: number, scale: GradeSystem): number | null {
  if (c.gradeMin === null || c.gradeMax === null) return null
  if (c.gradeScale !== scale) return null

  const gap = Math.max(0, min - c.gradeMax, c.gradeMin - max)
  return Math.max(0, 1 - gap * 0.2)
}

/** Falls off across the radius asked for; nought at its edge and beyond. */
function nearness(c: Candidate, centre: { lat: number; lon: number }, withinKm: number): number | null {
  if (c.lat === null || c.lon === null) return null
  const km = distanceM({ lat: c.lat, lon: c.lon }, centre) / 1000
  return Math.max(0, 1 - km / withinKm)
}

interface Contribution {
  readonly weighted: number
  /** What the reason says when this contribution is the largest one. */
  readonly because: string
}

/**
 * Whether a route's weather answers "no rain for `days` days". Null weather is
 * nothing known — never fetched, or no coordinates — and answers no: a dry
 * spell nobody measured is not one to promise. A null count with weather known
 * is no rain anywhere in the window, which clears every figure the parser reads.
 */
export function dryFor(weather: { readonly daysSinceRain: number | null } | null, days: number): boolean {
  if (weather === null) return false
  return weather.daysSinceRain === null || weather.daysSinceRain >= days
}

/**
 * Why a route is where it is, in the design's own register: a sentence, never a
 * number. `find-screen.html` reads "Te lo proponiamo perché è il più vicino del
 * gruppo" — a reason a climber can agree or disagree with.
 *
 * A score on screen would invite comparing two routes' scores, and this data
 * does not support that precision: how recent a report is and how near a
 * route is are not commensurable to two decimal places.
 */
export function rank(
  candidates: readonly Candidate[],
  constraints: readonly Constraint[],
  opts: RankOpts,
): readonly Ranked[] {
  const { now, centre } = opts
  const near = constraints.find(c => c.kind === 'near')
  const grade = constraints.find(c => c.kind === 'grade')

  const scored = candidates.map(candidate => {
    const parts: Contribution[] = []

    const reported = Math.min(candidate.recent, ENOUGH_RECENT) / ENOUGH_RECENT
    if (reported > 0) {
      parts.push({
        weighted: reported * WEIGHT.reports,
        because: candidate.recent === 1
          ? 'qualcuno c’è stato da poco e l’ha raccontata'
          : 'in diversi ci sono stati da poco e l’hanno raccontata',
      })
    }

    // Without a resolved centre there is no distance to score: the place was
    // named but nothing could say where it is. The route keeps its other
    // contributions rather than being punished for the caller's gap.
    if (near && centre) {
      const fit = nearness(candidate, centre, near.withinKm)
      if (fit !== null && fit > 0) {
        parts.push({ weighted: fit * WEIGHT.distance, because: 'è il più vicino del gruppo' })
      }
    }

    const fit = grade ? gradeFit(candidate, grade.min, grade.max, grade.scale) : null
    if (grade && fit !== null && fit > 0) {
      parts.push({ weighted: fit * WEIGHT.grade, because: 'è in pieno nel grado che cerchi' })
    }

    const fresh = recency(candidate.lastReportAt, now)
    if (fresh > 0) {
      parts.push({ weighted: fresh * WEIGHT.recency, because: 'è stata raccontata da poco' })
    }

    const score = parts.reduce((sum, p) => sum + p.weighted, 0)

    // A route kept in spite of a soft constraint says so instead of saying why
    // it won: being over your grade and still worth offering is the more useful
    // thing to know, and the design says it in those words -- "al limite del tuo
    // AD, ma la roccia è asciutta". Outside the range at all, not merely scoring
    // nought: a route two steps over still failed the thing that was asked.
    const kept = grade !== undefined && fit !== null && fit < 1
    const best = parts.reduce<Contribution | null>(
      (b, p) => (b === null || p.weighted > b.weighted ? p : b), null)

    const why = kept
      ? `Al limite del tuo ${grade.written.replace(/^fino a /, '').replace(/^dal (\S+) in su$/, '$1')}, ma è quello che il resto della ricerca chiede.`
      : best
        ? `Te lo proponiamo perché ${best.because}.`
        : 'Rientra in quello che hai chiesto.'

    return { candidate, score, why }
  })

  // Sorted by score, then by name -- an arbitrary order is still an order
  // somebody will read meaning into, so it is stated rather than left to
  // whatever the database happened to return.
  return [...scored].sort((a, b) =>
    b.score - a.score || a.candidate.name.localeCompare(b.candidate.name, 'it'))
}
