export class QuantityError extends Error {}

export interface Quantity<T> {
  readonly kind: string
  /**
   * The unit as it is written beside a figure — 'm', 'giorni', 'min'. `format`
   * already states it, but a form has to put it after an empty box, where there
   * is no formatted value to read it out of. Absent when the quantity is a bare
   * number: an absent unit means *print nothing*, never an empty one.
   */
  readonly unit?: string
  parse(raw: unknown): T
  format(value: T): string
}

export interface Ordered<T> extends Quantity<T> {
  ordinal(value: T): number
}

export type Aspect = 'N' | 'NE' | 'E' | 'SE' | 'S' | 'SO' | 'O' | 'NO'

/** Italian compass points, as they appear on screen. */
export const ASPECT_LABELS: Record<Aspect, string> = {
  N: 'Nord', NE: 'Nord-Est', E: 'Est', SE: 'Sud-Est',
  S: 'Sud', SO: 'Sud-Ovest', O: 'Ovest', NO: 'Nord-Ovest',
}

function wholeNumber(kind: string, unit: string): Quantity<number> {
  return {
    kind,
    // `count` is declared with '', which is no unit at all rather than an empty
    // one. Absent, so that "does this have a unit?" is one question with one
    // answer for both the formatter below and whoever renders a box to fill in.
    unit: unit || undefined,
    parse(raw) {
      if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 0) {
        throw new QuantityError(`${kind}: expected a whole number of ${kind}, got ${JSON.stringify(raw)}`)
      }
      return raw
    },
    format: v => (unit ? `${v} ${unit}` : String(v)),
  }
}

export const metres = wholeNumber('metres', 'm')
export const minutes = wholeNumber('minutes', 'min')
export const dayCount = wholeNumber('days', 'giorni')
export const count = wholeNumber('count', '')

export const text: Quantity<string> = {
  kind: 'text',
  parse(raw) {
    if (typeof raw !== 'string' || raw.trim() === '') {
      throw new QuantityError(`text: expected a non-empty string, got ${JSON.stringify(raw)}`)
    }
    return raw
  },
  format: v => v,
}

export const aspect: Quantity<Aspect> = {
  kind: 'aspect',
  parse(raw) {
    if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(ASPECT_LABELS, raw)) {
      throw new QuantityError(`aspect: expected one of ${Object.keys(ASPECT_LABELS).join(', ')}, got ${JSON.stringify(raw)}`)
    }
    return raw as Aspect
  },
  format: v => ASPECT_LABELS[v],
}

export const boolean: Quantity<boolean> = {
  kind: 'boolean',
  parse(raw) {
    if (typeof raw !== 'boolean') {
      throw new QuantityError(`boolean: expected true or false, got ${JSON.stringify(raw)}`)
    }
    return raw
  },
  // Capitalised: a yes/no fact is the whole value of its cell, read on its own.
  format: v => (v ? 'Sì' : 'No'),
}

/** A clock time. Ordered by minutes since midnight, so a span of two can be checked. */
export const timeOfDay: Ordered<string> = {
  kind: 'timeOfDay',
  parse(raw) {
    if (typeof raw !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(raw)) {
      throw new QuantityError(`timeOfDay: expected HH:MM, got ${JSON.stringify(raw)}`)
    }
    return raw
  },
  format: v => v,
  ordinal: v => Number(v.slice(0, 2)) * 60 + Number(v.slice(3, 5)),
}

/**
 * A guidebook's star rating. Whole stars, one to five: half a star is a
 * precision nobody who wrote the guidebook had, and zero is not a rating but
 * the absence of one, which the registry already has a way to say.
 */
export const stars: Quantity<number> = {
  kind: 'stars',
  parse(raw) {
    if (typeof raw !== 'number' || !Number.isInteger(raw) || raw < 1 || raw > 5) {
      throw new QuantityError(`stars: expected a whole number from 1 to 5, got ${JSON.stringify(raw)}`)
    }
    return raw
  },
  format: v => `${v} su 5`,
}

export type WallAngle = 'placca' | 'verticale' | 'strapiombante' | 'tetto'

/** Slab to roof. The order is a fact about the scale, even before anything compares two. */
const WALL_ANGLES: readonly WallAngle[] = ['placca', 'verticale', 'strapiombante', 'tetto']

const WALL_ANGLE_LABELS: Record<WallAngle, string> = {
  placca: 'Placca', verticale: 'Verticale', strapiombante: 'Strapiombante', tetto: 'Tetto',
}

export const wallAngle: Ordered<WallAngle> = {
  kind: 'wallAngle',
  parse(raw) {
    if (typeof raw !== 'string' || !(WALL_ANGLES as readonly string[]).includes(raw)) {
      throw new QuantityError(`wallAngle: expected one of ${WALL_ANGLES.join(', ')}, got ${JSON.stringify(raw)}`)
    }
    return raw as WallAngle
  },
  format: v => WALL_ANGLE_LABELS[v],
  ordinal: v => WALL_ANGLES.indexOf(v),
}

/**
 * The angles a crag's walls take, as a set: few crags are only slab or only
 * overhang, and a guidebook that says "dalle placche a brevi strapiombi" is
 * stating two facts, not hedging between them. Stored slab to roof whatever
 * order it was written in. A single angle written as a bare string, as the
 * fact was first stored, is read as a set of one; a repeat is refused, as for
 * seasons.
 */
export const wallAngles: Quantity<readonly WallAngle[]> = {
  kind: 'wallAngles',
  parse(raw) {
    const list = typeof raw === 'string' ? [raw] : raw
    if (!Array.isArray(list) || list.length === 0) {
      throw new QuantityError(`wallAngles: expected a non-empty list of angles, got ${JSON.stringify(raw)}`)
    }
    for (const a of list) {
      if (typeof a !== 'string' || !(WALL_ANGLES as readonly string[]).includes(a)) {
        throw new QuantityError(`wallAngles: ${JSON.stringify(a)} is not one of ${WALL_ANGLES.join(', ')}`)
      }
    }
    if (new Set(list).size !== list.length) {
      throw new QuantityError(`wallAngles: ${JSON.stringify(raw)} names an angle twice`)
    }
    return WALL_ANGLES.filter(a => (list as string[]).includes(a))
  },
  // "Placca, verticale": one capital, as the seasons read.
  format: set => set.map((a, i) => (i === 0 ? WALL_ANGLE_LABELS[a] : a)).join(', '),
}

/** What a crag is made of, as a guidebook's side column names it. */
export type Rock =
  | 'calcare' | 'dolomia' | 'calcescisto' | 'gneiss' | 'granito' | 'quarzite' | 'conglomerato'
  | 'arenaria' | 'serpentinite' | 'porfido' | 'basalto'

export const ROCK_LABELS: Record<Rock, string> = {
  calcare: 'Calcare', dolomia: 'Dolomia', calcescisto: 'Calcescisto', gneiss: 'Gneiss', granito: 'Granito',
  quarzite: 'Quarzite', conglomerato: 'Conglomerato', arenaria: 'Arenaria', serpentinite: 'Serpentinite',
  porfido: 'Porfido', basalto: 'Basalto',
}

export const rock: Quantity<Rock> = {
  kind: 'rock',
  parse(raw) {
    if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(ROCK_LABELS, raw)) {
      throw new QuantityError(`rock: expected one of ${Object.keys(ROCK_LABELS).join(', ')}, got ${JSON.stringify(raw)}`)
    }
    return raw as Rock
  },
  format: v => ROCK_LABELS[v],
}

/**
 * How a climb is protected, as a climber chooses one: bolted throughout, bolted
 * with gaps a cam or a nut fills, or protected by whoever climbs it. The detail
 * (which cams, how many quickdraws) stays in the words; this is the choice.
 */
export type Protection = 'spittata' | 'da_integrare' | 'trad'

export const PROTECTION_LABELS: Record<Protection, string> = {
  spittata: 'Spittata', da_integrare: 'Da integrare', trad: 'Trad',
}

export const protection: Quantity<Protection> = {
  kind: 'protection',
  parse(raw) {
    if (typeof raw !== 'string' || !Object.prototype.hasOwnProperty.call(PROTECTION_LABELS, raw)) {
      throw new QuantityError(
        `protection: expected one of ${Object.keys(PROTECTION_LABELS).join(', ')}, got ${JSON.stringify(raw)}`)
    }
    return raw as Protection
  },
  format: v => PROTECTION_LABELS[v],
}

export type SeasonName = 'primavera' | 'estate' | 'autunno' | 'inverno'

/** Calendar order from spring; the four sit on a circle, so inverno is followed by primavera. */
const SEASONS: readonly SeasonName[] = ['primavera', 'estate', 'autunno', 'inverno']

const SEASON_LABELS: Record<SeasonName, string> = {
  primavera: 'Primavera', estate: 'Estate', autunno: 'Autunno', inverno: 'Inverno',
}

/**
 * The seasons a crag is recommended for, as a set. Stored in calendar order
 * whatever order it was written in; a repeat is refused rather than collapsed,
 * because a list that names a season twice was written by mistake and the
 * mistake might be the other season.
 */
export const seasons: Quantity<readonly SeasonName[]> = {
  kind: 'seasons',
  parse(raw) {
    if (!Array.isArray(raw) || raw.length === 0) {
      throw new QuantityError(`seasons: expected a non-empty list of seasons, got ${JSON.stringify(raw)}`)
    }
    for (const s of raw) {
      if (typeof s !== 'string' || !(SEASONS as readonly string[]).includes(s)) {
        throw new QuantityError(`seasons: ${JSON.stringify(s)} is not one of ${SEASONS.join(', ')}`)
      }
    }
    if (new Set(raw).size !== raw.length) {
      throw new QuantityError(`seasons: ${JSON.stringify(raw)} names a season twice`)
    }
    return SEASONS.filter(s => (raw as string[]).includes(s))
  },
  format: formatSeasons,
}

/**
 * "Autunno, inverno, primavera", never "Primavera, autunno, inverno": a set
 * that wraps round the year is read from the season after its gap. Spring and
 * autumn together are the guidebooks' "mezze stagioni", and all four are
 * "tutto l’anno". A set with two gaps (summer and winter) has no natural
 * start, and reads in calendar order.
 */
function formatSeasons(set: readonly SeasonName[]): string {
  if (set.length === SEASONS.length) return "Tutto l’anno"
  if (set.length === 2 && set.includes('primavera') && set.includes('autunno')) return 'Mezze stagioni'

  const has = SEASONS.map(s => set.includes(s))
  const starts = SEASONS.map((_, i) => i).filter(i => has[i] && !has[(i + SEASONS.length - 1) % SEASONS.length])
  const from = starts.length === 1 ? starts[0]! : 0
  const ordered = SEASONS.map((_, k) => SEASONS[(from + k) % SEASONS.length]!).filter(s => set.includes(s))

  return ordered.map((s, i) => (i === 0 ? SEASON_LABELS[s] : s)).join(', ')
}

const SCALES = {
  alpine: ['F', 'F+', 'PD-', 'PD', 'PD+', 'AD-', 'AD', 'AD+', 'D-', 'D', 'D+',
           'TD-', 'TD', 'TD+', 'ED-', 'ED', 'ED+', 'EX'],
  // The plus steps below 6a are what Italian topos write ("5c+"), and every
  // step from 4a up has one. Inserting them moved every sport ordinal above
  // 4a; db/migrations/017_sport_plus_steps.sql moved the stored ones with it.
  // A step added here again needs a migration like it.
  sport: ['3', '4a', '4a+', '4b', '4b+', '4c', '4c+', '5a', '5a+', '5b', '5b+', '5c', '5c+',
          '6a', '6a+', '6b', '6b+', '6c', '6c+',
          '7a', '7a+', '7b', '7b+', '7c', '7c+',
          '8a', '8a+', '8b', '8b+', '8c', '8c+', '9a'],
} as const

/**
 * The steps of a scale, in order. `ordinal` maps a grade to its index; this is
 * what makes the inverse possible without every caller keeping its own copy of
 * the list — a stored ordinal has to be written back as a grade somewhere.
 */
export function gradeSteps(system: 'alpine' | 'sport'): readonly string[] {
  return SCALES[system]
}

/**
 * The steps a grade chart draws, one bar each. On the sport scale a plus counts
 * with its letter — 6a+ is a 6a on a chart — because a bar per half step spreads
 * a crag thinner than a climber reads it. The alpine scale is drawn as it is.
 */
export function chartSteps(system: 'alpine' | 'sport'): readonly string[] {
  return system === 'sport' ? SCALES.sport.filter(s => !s.endsWith('+')) : SCALES[system]
}

/** The chart step a grade is counted in: `chartStep('sport', '6a+')` is `'6a'`. */
export function chartStep(system: 'alpine' | 'sport', grade: string): string {
  return system === 'sport' && grade.endsWith('+') ? grade.slice(0, -1) : grade
}

/**
 * Which colour of the difficulty scale a sport grade is drawn in: its number, 3 to 9, as on a
 * climbing gym's circuits (3 lilac, 4 green, 5 orange, 6 blue, 7 red, 8 black, 9 pearl). The
 * letter does not matter: 6a and 6c+ are the same blue. An alpine grade or anything off the
 * sport scale has no band and is drawn as before.
 */
export type GradeBand = 3 | 4 | 5 | 6 | 7 | 8 | 9

export function sportGradeBand(grade: string): GradeBand | null {
  if (!(SCALES.sport as readonly string[]).includes(grade)) return null
  const n = Number(grade[0])
  return n >= 3 && n <= 9 ? (n as GradeBand) : null
}

export function gradeScale(system: 'alpine' | 'sport'): Ordered<string> {
  const steps: readonly string[] = SCALES[system]
  const index = new Map(steps.map((s, i) => [s, i]))
  return {
    kind: `grade:${system}`,
    parse(raw) {
      if (typeof raw !== 'string' || !index.has(raw)) {
        throw new QuantityError(`grade:${system}: ${JSON.stringify(raw)} is not on this scale`)
      }
      return raw
    },
    format: v => v,
    ordinal: v => index.get(v) ?? -1,
  }
}

/** A span of one quantity: "6a a 7c", "14 a 34 m". */
export function rangeOf<T>(q: Quantity<T>): Quantity<[T, T]> {
  const rank = (v: T) => ('ordinal' in q ? (q as Ordered<T>).ordinal(v) : Number(v))
  return {
    kind: `range:${q.kind}`,
    parse(raw) {
      if (!Array.isArray(raw) || raw.length !== 2) {
        throw new QuantityError(`range:${q.kind}: expected a pair, got ${JSON.stringify(raw)}`)
      }
      const pair: [T, T] = [q.parse(raw[0]), q.parse(raw[1])]
      if (rank(pair[0]) > rank(pair[1])) {
        throw new QuantityError(`range:${q.kind}: ${String(raw[0])} is above ${String(raw[1])}`)
      }
      return pair
    },
    // "14 a 34 m", not "14 m a 34 m" — the unit is stated once, as on the mockups.
    format([lo, hi]) {
      const high = q.format(hi)
      const low = q.format(lo).replace(/\s\D+$/, '')
      return `${low} a ${high}`
    },
  }
}
