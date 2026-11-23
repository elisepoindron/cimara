import { ACTIVITIES } from '../activities/index.ts'
import { gradeSteps, type Ordered, type Quantity } from '../quantity.ts'

/**
 * Which grade scale a constraint's ordinals belong to. Ordinals are comparable
 * only inside one scale — `AD` is 6 on the alpine scale and `6a` is 13 on the
 * sport one — so the scale travels with every grade constraint. A consumer that
 * drops it is comparing two different numbers that happen to be integers.
 */
export type GradeSystem = 'alpine' | 'sport'

export type Constraint =
  | { readonly kind: 'activity'; readonly id: string; readonly label: string
      /** True when something other than the activity's own name implied it: a grade, or a fact phrase only one activity declares. */
      readonly inferred: boolean }
  | { readonly kind: 'place';    readonly id: string; readonly name: string }
  | { readonly kind: 'near';     readonly placeId: string; readonly placeName: string
      readonly withinKm: number
      /** Set where the visitor said "vicino a" and no figure: Find may widen it. */
      readonly loose?: true }
  | { readonly kind: 'grade';    readonly scale: GradeSystem
      readonly min: number; readonly max: number
      /** Italian, canonically spelled: what the sentence reads back. */
      readonly written: string }
  | { readonly kind: 'fact'
      /**
       * Every activity that declares this phrase on this fact — one for most,
       * several for a shared one like `esposte a sud`. The question applies to
       * a route of any of them, and names an activity only when it is one.
       */
      readonly activities: readonly string[]; readonly id: string
      readonly match: 'is' | 'includes' | 'atMost' | 'atLeast'; readonly value: string | boolean | number
      /** The phrase as the visitor's spelling of it was declared — what the sentence reads back. */
      readonly written: string }
  | { readonly kind: 'dry'
      /** Days without rain, counted back from today: at most `DRY_MAX_DAYS`. */
      readonly days: number
      readonly written: string }
  | { readonly kind: 'name';     readonly text: string }

export interface Vocabulary {
  readonly activities: readonly { id: string; label: string }[]
  readonly places: readonly { id: string; name: string }[]
}

// ---------------------------------------------------------------------------
// Folding
// ---------------------------------------------------------------------------

/**
 * Apostrophes a visitor might type where the archive holds one. `Valle
 * dell’Orco` is spelled with U+2019 and nobody's keyboard offers it first.
 */
const APOSTROPHES = /[‘’ʹʼʻ`´′]/g

const COMBINING_MARKS = /\p{Mn}+/gu

/** Punctuation a word may be wearing, and which no vocabulary entry means. */
const LEADING_PUNCTUATION = /^[^\p{L}\p{N}]+/u
/**
 * Trailing punctuation, sparing `+`, `-` and `'`: `PD+`, `AD-` and `6a+` are
 * grades, and a word may legitimately end in an apostrophe.
 */
const TRAILING_PUNCTUATION = /[^\p{L}\p{N}'+-]+$/u

/** A word with the punctuation it was wearing taken off, case untouched. */
function bareWord(word: string): string {
  return word.replace(LEADING_PUNCTUATION, '').replace(TRAILING_PUNCTUATION, '')
}

/**
 * The form two words are compared in: case folded, apostrophes made plain,
 * accents dropped, punctuation trimmed off either end.
 *
 * Accents go because a visitor typing `Citta` means `Città` and this is a
 * search box, not a form. None of this reaches a constraint: matching folds,
 * what is handed on does not.
 */
function fold(word: string): string {
  return word
    .normalize('NFD')
    .replace(COMBINING_MARKS, '')
    .replace(APOSTROPHES, '\'')
    .toLowerCase()
    .replace(LEADING_PUNCTUATION, '')
    .replace(TRAILING_PUNCTUATION, '')
}

interface Token {
  /** Exactly what the visitor typed, punctuation and all. */
  readonly text: string
  /** The same word with edge punctuation off, for asking a scale about it. */
  readonly bare: string
  /** The folded form, for comparing against the vocabulary. */
  readonly norm: string
}

/**
 * Words, split on runs of whitespace of any width — so a doubled space, a tab
 * and a non-breaking space are all one separator.
 */
function tokenise(line: string): Token[] {
  const tokens: Token[] = []
  for (const word of line.split(/\s+/u)) {
    if (word === '') continue
    tokens.push({ text: word, bare: bareWord(word), norm: fold(word) })
  }
  return tokens
}

// ---------------------------------------------------------------------------
// The scales, read off the registry
// ---------------------------------------------------------------------------

const GRADE_KIND = 'grade:'

interface Scale {
  readonly system: GradeSystem
  readonly quantity: Ordered<string>
  /** The activity a grade on this scale implies, where exactly one does. */
  readonly activity: { readonly id: string; readonly label: string } | null
}

/** The scale a quantity *is*, or null. A range of grades is not a grade. */
function systemOf(quantity: Quantity<unknown>): GradeSystem | null {
  if (!('ordinal' in quantity)) return null
  if (!quantity.kind.startsWith(GRADE_KIND)) return null
  const system = quantity.kind.slice(GRADE_KIND.length)
  // A third scale changes this union and `GradeSystem` together; until it does,
  // an unrecognised one is skipped rather than typed as one of these two.
  return system === 'alpine' || system === 'sport' ? system : null
}

/**
 * Every grade scale the vocabulary's activities actually declare, and which
 * activity each one names.
 *
 * Nothing here is a list written into this file: the activities come from the
 * caller, their schemas from the registry, and a scale is recognised by asking
 * a declared quantity whether it is an ordered grade — the same test
 * `gradeBoundsOf` makes. An activity id no registry file declares contributes
 * nothing, which is why a vocabulary can be narrower than the registry.
 *
 * The activity is named only when exactly one activity in the vocabulary uses
 * the scale. Two would make the inference a guess, and a guess here becomes a
 * *hard* constraint that removes the routes the visitor wanted; better to leave
 * the grade standing alone. Today the alpine scale belongs to alpinismo and the
 * sport scale to falesia, and the nineteenth activity is where this earns its
 * keep.
 */
function scalesOf(vocabulary: Vocabulary): Scale[] {
  const found = new Map<GradeSystem, { quantity: Ordered<string>; activities: { id: string; label: string }[] }>()

  for (const entry of vocabulary.activities) {
    const schema = ACTIVITIES[entry.id]
    if (!schema) continue

    const seen = new Set<GradeSystem>()
    for (const def of [...schema.facts, ...(schema.parts?.fields ?? [])]) {
      const system = systemOf(def.quantity)
      if (system === null || seen.has(system)) continue
      seen.add(system)

      const slot = found.get(system)
      if (slot) slot.activities.push(entry)
      else found.set(system, { quantity: def.quantity as Ordered<string>, activities: [entry] })
    }
  }

  // Sorted by name so that the order the vocabulary happens to arrive in never
  // decides which scale is asked first.
  return [...found.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([system, slot]) => ({
      system,
      quantity: slot.quantity,
      activity: slot.activities.length === 1 ? slot.activities[0]! : null,
    }))
}

interface Grade {
  readonly scale: Scale
  readonly ordinal: number
  /** The grade as its scale writes it: `AD+`, `6a+`. */
  readonly written: string
}

/**
 * The grade a word names, asked of the scales themselves rather than of a list
 * kept here. Three spellings are tried, because a scale is written one way and
 * typed three: `AD` is shouted, `ad` is not, and `6A` is a caps-lock `6a`.
 */
function readGrade(token: Token, scales: readonly Scale[]): Grade | null {
  if (token.bare === '') return null
  const spellings = [token.bare, token.bare.toUpperCase(), token.bare.toLowerCase()]

  for (const scale of scales) {
    for (const spelling of spellings) {
      try {
        const value = scale.quantity.parse(spelling)
        return { scale, ordinal: scale.quantity.ordinal(value), written: value }
      } catch { /* not on this scale, spelled this way */ }
    }
  }
  return null
}

/** Does this word look like a grade at all, rather than merely parse as one? */
function looksLikeAGrade(token: Token): boolean {
  // The sport scale's bottom step is the bare numeral `3`, and a bare numeral in
  // a search line is far more often a year, a height, a sector or half a route
  // name. So a grade standing on its own must carry a letter; `fino a 3` and
  // `dal 3 al 5a` are how a numeral means a grade, and there the visitor said so.
  return /\p{L}/u.test(token.bare)
}

// ---------------------------------------------------------------------------
// Candidates
// ---------------------------------------------------------------------------

interface Match {
  /** How many tokens this reading consumes. Never zero. */
  readonly length: number
  readonly constraints: readonly Constraint[]
  /** A difficulty said in words, turned into grades once the activity is known. */
  readonly level?: { readonly level: Level; readonly text: string }
}

interface Candidate {
  /** The fixed first word of this form, where it has one: a cheap prefilter. */
  readonly first: string | null
  match(tokens: readonly Token[], at: number): Match | null
}

interface Phrase {
  readonly words: readonly string[]
  /**
   * For a name of one or two letters, the spelling it must be typed in. `TO`
   * is Torino's province and `to` is nothing; `NO` is Novara and `no` is no;
   * `SI` is Siena and `si` is yes. Folding case would make every one of these
   * a place, so a name this short is read only as it is written.
   */
  readonly exact?: string
  readonly make: () => Constraint
  /** Activities sort above places at equal length; see `candidatesOf`. */
  readonly rank: number
  readonly key: string
}

/** The longest name read only as it is written; see `Phrase.exact`. */
const EXACT_MAX_LENGTH = 2

function phraseOf(name: string, rank: number, key: string, make: () => Constraint): Phrase | null {
  const words = tokenise(name).map(t => t.norm).filter(w => w !== '')
  if (words.length === 0) return null
  const exact = words.length === 1 && words[0]!.length <= EXACT_MAX_LENGTH ? bareWord(name.trim()) : undefined
  return exact === undefined ? { words, make, rank, key } : { words, make, rank, key, exact }
}

function phraseMatches(phrase: Phrase, tokens: readonly Token[], at: number, forgiving = false): boolean {
  if (at + phrase.words.length > tokens.length) return false
  if (phrase.exact !== undefined) return tokens[at]!.bare === phrase.exact
  return phrase.words.every((word, i) => {
    const typed = tokens[at + i]!.norm
    return typed === word || (forgiving && isTypoOf(typed, word))
  })
}

/**
 * The shortest word a typo is forgiven in. Below five letters one edit is too
 * large a share of the word: `Lago` is one letter from `Lagi`, `Rosa` from
 * `Rose`, and a short name in this archive is far more likely to be a different
 * name than a misspelt one.
 */
const TYPO_MIN_LENGTH = 5

/**
 * Whether `typed` is `word` with one slip: a letter changed, added, dropped, or
 * two neighbours swapped — the four ways a finger misses. `Torine` is `Torino`;
 * `falaise` is three edits from `falesia` and is not, because by then it is a
 * different word and guessing would put a constraint on screen nobody asked for.
 */
function isTypoOf(typed: string, word: string): boolean {
  if (Math.min(typed.length, word.length) < TYPO_MIN_LENGTH) return false
  if (Math.abs(typed.length - word.length) > 1) return false
  if (typed === word) return true

  let i = 0
  while (i < typed.length && i < word.length && typed[i] === word[i]) i++

  const restTyped = typed.slice(i)
  const restWord = word.slice(i)
  return restTyped.slice(1) === restWord.slice(1)       // changed
    || restTyped.slice(1) === restWord                  // added
    || restTyped === restWord.slice(1)                  // dropped
    || (restTyped.length >= 2 && restTyped[0] === restWord[1] && restTyped[1] === restWord[0]
        && restTyped.slice(2) === restWord.slice(2))    // swapped
}

/**
 * A place's name and the other ways a valley is written: `Val di Susa` is
 * also `Val Susa`, `Valle di Susa`, `Valle Susa` and `Valsusa`. Derived from
 * the name the archive holds, so it is still the archive that says the valley
 * exists. Anything that is not a valley is only its own name.
 */
function spellingsOf(name: string): readonly string[] {
  const valley = /^Val(?:le)?\s+(?:di\s+|d['’]\s*)?(\S.*)$/u.exec(name)
  if (!valley) return [name]
  const rest = valley[1]!
  const joined = /\s/u.test(rest) ? [] : [`Val${rest.toLowerCase()}`]
  return [...new Set([name, `Val ${rest}`, `Val di ${rest}`, `Valle ${rest}`, `Valle di ${rest}`, ...joined])]
}

/**
 * Every vocabulary phrase, longest first.
 *
 * Longest first is the whole of the rule that `Val Grande di Lanzo` is a place
 * and not `Val Grande` followed by two loose words. Ties break on rank then on
 * the entry's own key, so `parse` is a function of the vocabulary's *contents*
 * and not of the order a query happened to return them in.
 *
 * Activities outrank places at equal length: an activity names a whole class of
 * itineraries and a place that shares its name is still reachable by typing more
 * of it, while the reverse is not true.
 */
function vocabularyPhrases(vocabulary: Vocabulary): Phrase[] {
  const phrases: Phrase[] = []

  for (const activity of vocabulary.activities) {
    const constraint = (): Constraint =>
      ({ kind: 'activity', id: activity.id, label: activity.label, inferred: false })
    // Its id, its label, and how the sentence and a climber name it: the
    // sentence writes "vie di alpinismo", so a line typed that way must read.
    const declared = ACTIVITIES[activity.id]
    const spellings = [activity.id, activity.label, declared?.plural?.it, declared?.singular?.it, ...(declared?.also?.it ?? [])]
    for (const spelling of spellings.filter((s): s is string => s !== undefined)) {
      const phrase = phraseOf(spelling, 0, activity.id, constraint)
      if (phrase) phrases.push(phrase)
    }
  }

  for (const place of vocabulary.places) {
    for (const spelling of spellingsOf(place.name)) {
      const phrase = phraseOf(spelling, 1, place.id,
        () => ({ kind: 'place', id: place.id, name: place.name }))
      if (phrase) phrases.push(phrase)
    }
  }

  phrases.push(...factPhrases(vocabulary))

  return phrases.sort((a, b) =>
    b.words.length - a.words.length
    || a.rank - b.rank
    || (a.words.join(' ') < b.words.join(' ') ? -1 : a.words.join(' ') > b.words.join(' ') ? 1 : 0)
    || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0))
}

/**
 * The phrases the vocabulary's activities declare on their facts. Read off the
 * registry exactly as the grade scales are: an activity the vocabulary does
 * not hold contributes nothing. They rank with activities — like an activity,
 * a fact phrase names a class of itineraries rather than one row.
 *
 * A phrase two activities declare alike — the same spelling, fact, match and
 * value, as every activity with an aspect declares `esposte a sud` — is one
 * phrase naming both, so the line asks it of both rather than of whichever
 * activity happened to sort first.
 */
function factPhrases(vocabulary: Vocabulary): Phrase[] {
  const shared = new Map<string, { spelling: string; id: string; match: Extract<Constraint, { kind: 'fact' }>['match']
                                   value: string | boolean | number; activities: string[] }>()
  for (const entry of vocabulary.activities) {
    const schema = ACTIVITIES[entry.id]
    if (!schema) continue
    for (const def of schema.facts) {
      for (const f of def.find ?? []) {
        for (const spelling of f.it) {
          const key = `${spelling}:${def.id}:${f.match}:${String(f.value)}`
          const slot = shared.get(key)
          if (slot) { if (!slot.activities.includes(entry.id)) slot.activities.push(entry.id) }
          else shared.set(key, { spelling, id: def.id, match: f.match, value: f.value, activities: [entry.id] })
        }
      }
    }
  }

  const phrases: Phrase[] = []
  for (const p of shared.values()) {
    const activities = [...p.activities].sort()
    const phrase = phraseOf(p.spelling, 0, `${activities.join('+')}:${p.id}:${String(p.value)}`, () => ({
      kind: 'fact', activities, id: p.id, match: p.match, value: p.value, written: p.spelling,
    }))
    if (phrase) phrases.push(phrase)
  }
  return phrases
}

/**
 * Ordinary words a climber types that are also the name of a comune, now that
 * the vocabulary holds all of them: `grado` is Grado, `ora` is Ora, `bella` is
 * Bella, `canale` is Canale. Typed in lower case and not introduced as a place
 * (`a Grado`, `vicino a Ora`), each is the word, not the town. And none is
 * ever the town by forgiving a slip, nor the rock words a crag is described
 * by — `calcare` is one letter from Carcare.
 *
 * This is a list of Italian, not of the archive: which towns exist still comes
 * from the database, and this only says which words are words first.
 */
const WORDS_FIRST = new Set([
  'alto', 'bella', 'bello', 'bianco', 'canale', 'cave', 'cento', 'grado', 'grotte', 'lago', 'monti',
  'nove', 'ora', 'paese', 'parete', 'ponte', 'prato', 'sale', 'scala', 'sperone', 'vita',
  'calcare', 'granito', 'gneiss', 'arenaria', 'conglomerato', 'quarzite', 'serpentino', 'basalto',
])

/** The words that say a place is coming: `a Grado`, `da Ora`, `vicino a Canale`. */
const PLACE_LEADS = new Set(['a', 'ad', 'da', 'in', 'di', 'al', 'presso', 'verso', 'zona', 'sopra', 'sotto'])

/**
 * Whether the place `phrase` may be read at `at`: always, unless it is a single
 * word in `WORDS_FIRST` typed in lower case with nothing introducing it.
 */
function mayBePlace(phrase: Phrase, tokens: readonly Token[], at: number): boolean {
  if (phrase.rank !== 1 || phrase.words.length !== 1 || !WORDS_FIRST.has(phrase.words[0]!)) return true
  const typed = tokens[at]!.bare
  const capitalised = typed !== '' && typed[0] !== typed[0]!.toLowerCase()
  return capitalised || PLACE_LEADS.has(tokens[at - 1]?.norm ?? '')
}

/** A place name starting at `at`, longest first. Used by `entro … da …` too. */
function placeAt(
  places: readonly Phrase[], tokens: readonly Token[], at: number,
): { phrase: Phrase; length: number } | null {
  for (const forgiving of [false, true]) {
    if (forgiving && WORDS_FIRST.has(tokens[at]?.norm ?? '')) continue
    for (const phrase of places) {
      if (phraseMatches(phrase, tokens, at, forgiving)) return { phrase, length: phrase.words.length }
    }
  }
  return null
}

/** `40 km`, `40km`, `2,5 km`. */
const RADIUS = /^(\d+(?:[.,]\d+)?)(km)?$/u

/**
 * The words that may open a radius: `entro 40 km da Torino`, `a meno di 40 km
 * da Torino`, `a 40 km da Torino`, `fino a 40 km da Torino`, or none at all —
 * `40 km da Torino`. Each still needs the figure, the unit and `da`.
 */
const NEAR_LEADS: readonly (readonly string[])[] = [
  ['entro'], ['a', 'meno', 'di'], ['meno', 'di'], ['fino', 'a'], ['massimo'], ['max'], ['a'], [],
]

function nearCandidate(places: readonly Phrase[], lead: readonly string[]): Candidate {
  return {
    first: lead[0] ?? null,
    match(tokens, at) {
      if (!lead.every((w, k) => tokens[at + k]?.norm === w)) return null

      let i = at + lead.length
      const amount = RADIUS.exec(tokens[i]?.norm ?? '')
      if (!amount) return null
      i++

      if (!amount[2]) {
        const unit = tokens[i]?.norm
        // Only kilometres. "entro 2 ore da Torino" is drive time, which this
        // project deliberately cannot answer — see the spec — and must not come
        // back as a two-kilometre radius. Unreadable, it falls through to free
        // text, where the sentence shows the visitor it was not understood.
        if (unit !== 'km' && unit !== 'chilometri') return null
        i++
      }

      if (tokens[i]?.norm !== 'da') return null
      i++

      const place = placeAt(places, tokens, i)
      if (!place) return null

      const withinKm = Number(amount[1]!.replace(',', '.'))
      if (!Number.isFinite(withinKm) || withinKm <= 0) return null

      const entry = place.phrase.make()
      if (entry.kind !== 'place') return null

      return {
        length: i + place.length - at,
        constraints: [{
          kind: 'near', placeId: entry.id, placeName: entry.name, withinKm,
        }],
      }
    },
  }
}

/**
 * How far back the weather the archive caches can see: seven past days and
 * today (src/app/weather-client.ts). "No rain for ten days" is a question it
 * cannot answer, so it is not read rather than read as seven.
 */
export const DRY_MAX_DAYS = 7

/** The offers the sentence makes: the round figures a climber asks in. */
export const DRY_OFFERS: readonly number[] = [2, 3, 5, 7]

/** As the sentence writes a dry spell back. */
export function dryWritten(days: number): string {
  return days === 1 ? 'senza pioggia da 1 giorno' : `senza pioggia da ${days} giorni`
}

/** The ways of saying "dry" that a count of days follows. */
const DRY_OPENINGS: readonly (readonly string[])[] = [
  ['senza', 'pioggia', 'da'], ['non', 'piove', 'da'], ['asciutta', 'da'], ['asciutte', 'da'],
  ['asciutto', 'da'], ['asciutti', 'da'], ['niente', 'pioggia', 'da'],
]

/** `senza pioggia da 3 giorni`, `asciutta da almeno 3 giorni`, `non piove da 3 giorni`. */
function dryCandidate(opening: readonly string[]): Candidate {
  return {
    first: opening[0]!,
    match(tokens, at) {
      if (!opening.every((w, k) => tokens[at + k]?.norm === w)) return null
      let i = at + opening.length
      if (tokens[i]?.norm === 'almeno') i++
      const days = /^\d+$/u.test(tokens[i]?.norm ?? '') ? Number(tokens[i]!.norm) : NaN
      if (!Number.isInteger(days) || days < 1 || days > DRY_MAX_DAYS) return null
      i++
      const unit = tokens[i]?.norm
      if (unit !== 'giorni' && unit !== 'giorno' && unit !== 'gg') return null
      return { length: i + 1 - at, constraints: [{ kind: 'dry', days, written: dryWritten(days) }] }
    },
  }
}

/**
 * How long "dry" is when the visitor did not say: `una falesia asciutta`,
 * `alpinismo senza pioggia`. Three days is the middle of what the sentence
 * offers, and it shows the figure in its menu, where it is one click to change.
 */
export const DRY_DEFAULT_DAYS = 3

/** The ways of saying "dry" with no count after them. */
const DRY_BARE: readonly (readonly string[])[] = [
  ['senza', 'pioggia'], ['non', 'piove'], ['niente', 'pioggia'],
  ['asciutta'], ['asciutte'], ['asciutto'], ['asciutti'],
]

/**
 * `una falesia asciutta`: a dry spell of `DRY_DEFAULT_DAYS`. Tried after the
 * counted forms, and never where a count was begun: `senza pioggia da 10
 * giorni` asks what the weather cannot see, and is left unread rather than
 * answered as three.
 */
function bareDryCandidate(words: readonly string[]): Candidate {
  return {
    first: words[0]!,
    match: (tokens, at) => words.every((w, k) => tokens[at + k]?.norm === w) && tokens[at + words.length]?.norm !== 'da'
      ? { length: words.length,
          constraints: [{ kind: 'dry', days: DRY_DEFAULT_DAYS, written: dryWritten(DRY_DEFAULT_DAYS) }] }
      : null,
  }
}

/**
 * How far "near" is when the visitor did not say: `vicino a Susa`. Thirty
 * kilometres is a valley's length around here, and the sentence shows the
 * figure in its distance menu, where it is one click to change.
 */
export const NEARBY_KM = 30

/** The ways of saying "near" without a figure, each followed by a place. */
const NEARBY: readonly (readonly string[])[] = [
  ['vicino', 'a'], ['vicino', 'al'], ['vicino'], ['intorno', 'a'], ['attorno', 'a'],
  ['nei', 'dintorni', 'di'], ['dalle', 'parti', 'di'], ['non', 'lontano', 'da'], ['nei', 'pressi', 'di'],
  ['in', 'zona'], ['zona'],
  // "la falesia più vicina a Torino": the list is already ordered by distance.
  ['piu', 'vicina', 'a'], ['piu', 'vicino', 'a'], ['piu', 'vicine', 'a'], ['piu', 'vicini', 'a'],
]

/** `vicino a Susa`, `nei dintorni di Susa`: a radius of `NEARBY_KM` around a place. */
function nearbyCandidate(words: readonly string[], places: readonly Phrase[]): Candidate {
  return {
    first: words[0]!,
    match(tokens, at) {
      if (!words.every((w, k) => tokens[at + k]?.norm === w)) return null
      const place = placeAt(places, tokens, at + words.length)
      if (!place) return null
      const entry = place.phrase.make()
      if (entry.kind !== 'place') return null
      return {
        length: words.length + place.length,
        constraints: [{ kind: 'near', placeId: entry.id, placeName: entry.name, withinKm: NEARBY_KM, loose: true }],
      }
    },
  }
}

/**
 * The words that may sit between a comparison and its grade: `sopra il 6a`,
 * `oltre al 6a`, `più del 6a`, `tra il 6a e il 7a`. They carry nothing a
 * constraint needs.
 */
const ARTICLES = new Set(['il', 'al', 'lo', 'del', 'dello'])

/**
 * Which end of a step a bound means, where the visitor named a whole family of
 * steps rather than one: `tra 6a e 7` is up to the last of the sevens, `dal 7
 * in su` from the first of them.
 */
type Side = 'low' | 'high'

/**
 * A bare digit as a family of sport steps — `7` is 7a to 7c+ — read only where
 * the visitor wrote a comparison or a range around it, and so said it was a
 * grade. `3` is a step of its own and never gets here.
 */
function familyOf(token: Token, scales: readonly Scale[], side: Side): Grade | null {
  if (!/^\d$/u.test(token.bare)) return null
  const scale = scales.find(s => s.system === 'sport')
  if (!scale) return null
  const steps = gradeSteps('sport')
  const family = steps.map((g, i) => ({ g, i })).filter(({ g }) => g.startsWith(token.bare))
  const pick = side === 'low' ? family[0] : family[family.length - 1]
  return pick ? { scale, ordinal: pick.i, written: pick.g } : null
}

/** The grade a written form is about, past an optional article: how many tokens it took, and the grade. */
function gradeAfter(
  tokens: readonly Token[], at: number, scales: readonly Scale[], side: Side,
): { length: number; grade: Grade } | null {
  const skip = ARTICLES.has(tokens[at]?.norm ?? '') ? 1 : 0
  const token = tokens[at + skip]
  if (!token) return null
  const grade = readGrade(token, scales) ?? familyOf(token, scales, side)
  return grade ? { length: skip + 1, grade } : null
}

/**
 * A span of one scale, written back in the one form the sentence offers for
 * it: open at the top is `dal 6a in su`, open at the bottom `fino a 7b`, and
 * anything between `dal 6a al 7b`. However the visitor put it, they read back
 * where the line was drawn, in words the parser reads again.
 */
function spanOf(scale: Scale, min: number, max: number): Constraint {
  const steps = gradeSteps(scale.system)
  const top = steps.length - 1
  const written = min === 0 ? `fino a ${steps[max]!}`
    : max === top ? `dal ${steps[min]!} in su`
      : `dal ${steps[min]!} al ${steps[max]!}`
  return { kind: 'grade', scale: scale.system, min, max, written }
}

/** Matches `words` exactly at `at`. */
function wordsAt(words: readonly string[], tokens: readonly Token[], at: number): boolean {
  return words.every((w, k) => tokens[at + k]?.norm === w)
}

/**
 * Two grades and the span between them, read either way round: `dal 6a al
 * 7b`, `da 6a a 7b`, `tra 6a e 7`, `fra il 6a e il 7a`. A bare digit on either
 * side is its whole family, taken widest — `tra 6a e 7` runs to 7c+.
 */
function rangeCandidate(first: string, separators: readonly string[], scales: readonly Scale[]): Candidate {
  return {
    first,
    match(tokens, at) {
      if (tokens[at]?.norm !== first) return null
      const low = gradeAfter(tokens, at + 1, scales, 'low')
      if (!low) return null
      const sep = at + 1 + low.length
      if (!separators.includes(tokens[sep]?.norm ?? '')) return null
      const high = gradeAfter(tokens, sep + 1, scales, 'high')
      if (!high) return null
      // Two ordinals on two scales span nothing at all.
      if (low.grade.scale.system !== high.grade.scale.system) return null

      // Read either way round; a family on the far side is widened to match.
      const a = low.grade.ordinal
      const b = high.grade.ordinal
      const reversed = a > b
      const lo = reversed ? (gradeAfter(tokens, sep + 1, scales, 'low')!.grade.ordinal) : a
      const hi = reversed ? (gradeAfter(tokens, at + 1, scales, 'high')!.grade.ordinal) : b
      return {
        length: sep + 1 + high.length - at,
        constraints: [spanOf(low.grade.scale, Math.min(lo, hi), Math.max(lo, hi))],
      }
    },
  }
}

/**
 * One end of a span on its own, introduced by `words`: `fino a 7b`, `dal 6a in
 * su`, and the bare `dal 6a` and `al 7b` the sentence's two grade menus post
 * when only one end is set. `step` moves the bound past the grade named, for
 * the comparisons that exclude it: `sopra 6a` starts at 6a+, `sotto 6a` stops
 * at 5c. A bound past the end of the scale asks for nothing that exists and is
 * left as text, visibly unread.
 */
function boundCandidate(
  words: readonly string[], end: 'floor' | 'ceiling', step: 0 | 1, scales: readonly Scale[],
  after: readonly string[] = [],
): Candidate {
  // Excluding a family excludes all of it: `sopra 7` is from 8a, `sotto 7` up to 6c+.
  const side: Side = (end === 'floor') === (step === 0) ? 'low' : 'high'
  return {
    first: words[0]!,
    match(tokens, at) {
      if (!wordsAt(words, tokens, at)) return null
      const target = gradeAfter(tokens, at + words.length, scales, side)
      if (!target) return null
      const tail = at + words.length + target.length
      if (!wordsAt(after, tokens, tail)) return null

      const { scale, ordinal } = target.grade
      const top = gradeSteps(scale.system).length - 1
      const bound = end === 'floor' ? ordinal + step : ordinal - step
      if (bound < 0 || bound > top) return null

      return {
        length: tail + after.length - at,
        constraints: [end === 'floor' ? spanOf(scale, bound, top) : spanOf(scale, 0, bound)],
      }
    },
  }
}

/**
 * Every grade form the parser reads, in the order they are tried. The longer
 * forms sharing a first word go first — `dal 6a in su` and `dal 6a al 7b`
 * before the bare `dal 6a` — since the first to match at a position wins.
 *
 * `almeno` and `minimo` include the grade; `sopra`, `oltre` and `più di` are
 * taken at their word and start one step up, `sotto` and `meno di` one down.
 */
function gradeCandidates(scales: readonly Scale[]): Candidate[] {
  const forms = gradeForms(scales)
  // `grado 6a`, `di grado dal 6a in su`: the word for what a grade is, said
  // before one, is part of it — and not Grado, the comune in Friuli, which is
  // what it would otherwise be read as.
  const worded = [['di', 'grado'], ['grado'], ['gradi'], ['di', 'gradi']].map((lead): Candidate => ({
    first: lead[0]!,
    match(tokens, at) {
      if (!lead.every((w, k) => tokens[at + k]?.norm === w)) return null
      const next = at + lead.length
      // `grado 5`: the visitor said it is a grade, so a bare digit is its family.
      const token = tokens[next]
      const low = token ? familyOf(token, scales, 'low') : null
      const high = token ? familyOf(token, scales, 'high') : null
      if (low && high) {
        return { length: lead.length + 1, constraints: [spanOf(low.scale, low.ordinal, high.ordinal)] }
      }
      for (const form of [...forms, bareGradeCandidate(scales)]) {
        if (form.first !== null && form.first !== tokens[next]?.norm) continue
        const m = form.match(tokens, next)
        if (m) return { length: lead.length + m.length, constraints: m.constraints }
      }
      return null
    },
  }))
  return [...worded, joinedRangeCandidate(scales), ...forms, postfixCandidate(scales)]
}

/** `6a-6c`, `6a/6c`, `PD/AD`: a span written as one word. */
function joinedRangeCandidate(scales: readonly Scale[]): Candidate {
  return {
    first: null,
    match(tokens, at) {
      const token = tokens[at]
      if (!token || readGrade(token, scales)) return null
      const bare = token.bare
      for (let k = 1; k < bare.length - 1; k++) {
        if (!'-–/'.includes(bare[k]!)) continue
        const part = (s: string): Token => ({ text: s, bare: s, norm: fold(s) })
        const lo = readGrade(part(bare.slice(0, k)), scales)
        const hi = readGrade(part(bare.slice(k + 1)), scales)
        if (!lo || !hi || lo.scale.system !== hi.scale.system) continue
        return { length: 1, constraints: [spanOf(lo.scale, Math.min(lo.ordinal, hi.ordinal), Math.max(lo.ordinal, hi.ordinal))] }
      }
      return null
    },
  }
}

/** The words after a grade that make it a bound: `7a max`, `6a in giù`, `6a o più`. */
const POSTFIX: readonly { readonly words: readonly string[]; readonly end: 'floor' | 'ceiling' }[] = [
  { words: ['in', 'giu'], end: 'ceiling' }, { words: ['o', 'meno'], end: 'ceiling' },
  { words: ['max'], end: 'ceiling' }, { words: ['massimo'], end: 'ceiling' }, { words: ['al', 'massimo'], end: 'ceiling' },
  { words: ['in', 'su'], end: 'floor' }, { words: ['o', 'piu'], end: 'floor' },
  { words: ['minimo'], end: 'floor' }, { words: ['min'], end: 'floor' }, { words: ['come', 'minimo'], end: 'floor' },
]

function postfixCandidate(scales: readonly Scale[]): Candidate {
  return {
    first: null,
    match(tokens, at) {
      const token = tokens[at]
      if (!token || !looksLikeAGrade(token)) return null
      const grade = readGrade(token, scales)
      if (!grade) return null
      const top = gradeSteps(grade.scale.system).length - 1
      for (const { words, end } of POSTFIX) {
        if (!wordsAt(words, tokens, at + 1)) continue
        return { length: 1 + words.length,
                 constraints: [end === 'ceiling' ? spanOf(grade.scale, 0, grade.ordinal) : spanOf(grade.scale, grade.ordinal, top)] }
      }
      return null
    },
  }
}

function gradeForms(scales: readonly Scale[]): Candidate[] {
  return [
    boundCandidate(['dal'], 'floor', 0, scales, ['in', 'su']),
    boundCandidate(['da'], 'floor', 0, scales, ['in', 'su']),
    rangeCandidate('dal', ['al', 'a'], scales),
    rangeCandidate('da', ['a', 'al'], scales),
    rangeCandidate('tra', ['e'], scales),
    rangeCandidate('fra', ['e'], scales),
    boundCandidate(['fino', 'a'], 'ceiling', 0, scales),
    boundCandidate(['fino', 'al'], 'ceiling', 0, scales),
    boundCandidate(['al', 'massimo'], 'ceiling', 0, scales),
    boundCandidate(['massimo'], 'ceiling', 0, scales),
    boundCandidate(['max'], 'ceiling', 0, scales),
    boundCandidate(['non', 'oltre'], 'ceiling', 0, scales),
    boundCandidate(['non', 'piu', 'di'], 'ceiling', 0, scales),
    boundCandidate(['min'], 'floor', 0, scales),
    boundCandidate(['almeno'], 'floor', 0, scales),
    boundCandidate(['minimo'], 'floor', 0, scales),
    boundCandidate(['sopra'], 'floor', 1, scales),
    boundCandidate(['oltre'], 'floor', 1, scales),
    boundCandidate(['piu', 'di'], 'floor', 1, scales),
    boundCandidate(['piu'], 'floor', 1, scales),
    boundCandidate(['sotto'], 'ceiling', 1, scales),
    boundCandidate(['meno', 'di'], 'ceiling', 1, scales),
    boundCandidate(['meno'], 'ceiling', 1, scales),
    boundCandidate(['dal'], 'floor', 0, scales),
    boundCandidate(['da'], 'floor', 0, scales),
    boundCandidate(['al'], 'ceiling', 0, scales),
  ]
}

// ---------------------------------------------------------------------------
// Difficulty in words
// ---------------------------------------------------------------------------

/**
 * A difficulty said rather than graded. The alpine scale is itself made of
 * these words — PD is *poco difficile*, AD *abbastanza difficile*, TD *molto
 * difficile* — so where a climber says one of those, it is that grade.
 */
type Level = 'facile' | 'medio' | 'difficile' | 'pd' | 'ad' | 'td'

/**
 * Each level as a span of each scale, first step to last; `null` is the top
 * of the scale. Arguable on purpose, and all here, in one place: the sentence
 * reads the span back as grades, one click from any other.
 */
const LEVEL_SPANS: Record<GradeSystem, Record<Level, readonly [string, string | null]>> = {
  sport: {
    facile: ['3', '5c+'], medio: ['6a', '6b+'], difficile: ['7a', null],
    pd: ['3', '5c+'], ad: ['6a', '6b+'], td: ['7a', null],
  },
  alpine: {
    facile: ['F', 'PD+'], medio: ['AD-', 'AD+'], difficile: ['D-', null],
    pd: ['PD-', 'PD+'], ad: ['AD-', 'AD+'], td: ['TD-', null],
  },
}

/** The ways of saying a level, longest first so `non troppo difficile` is not `difficile`. */
const LEVEL_WORDS: readonly (readonly [Level, string])[] = ([
  ['medio', 'non troppo difficile'], ['medio', 'non troppo difficili'], ['medio', 'non troppo dura'],
  ['medio', 'non troppo dure'], ['medio', 'non troppo impegnativa'], ['medio', 'di media difficolta'],
  ['pd', 'poco difficile'], ['pd', 'poco difficili'], ['ad', 'abbastanza difficile'], ['ad', 'abbastanza difficili'],
  ['td', 'molto difficile'], ['td', 'molto difficili'], ['td', 'estremamente difficile'],
  ['facile', 'per principianti'], ['facile', 'per iniziare'], ['facile', 'piu facile'], ['facile', 'piu facili'],
  ['difficile', 'per esperti'], ['medio', 'media difficolta'],
  ['facile', 'facile'], ['facile', 'facili'], ['facile', 'semplice'], ['facile', 'semplici'],
  ['facile', 'facilissima'], ['facile', 'facilissime'], ['medio', 'intermedia'], ['medio', 'intermedie'],
  ['difficile', 'difficile'], ['difficile', 'difficili'], ['difficile', 'dura'], ['difficile', 'dure'],
  ['difficile', 'impegnativa'], ['difficile', 'impegnative'],
] as const satisfies readonly (readonly [Level, string])[]).toSorted((a, b) => b[1].split(' ').length - a[1].split(' ').length)

function levelCandidate(level: Level, it: string): Candidate {
  const words = it.split(' ')
  return {
    first: words[0]!,
    match: (tokens, at) => wordsAt(words, tokens, at)
      ? { length: words.length, constraints: [],
          level: { level, text: tokens.slice(at, at + words.length).map(t => t.text).join(' ') } }
      : null,
  }
}

/** A level as a span of `scale`. */
function levelSpan(scale: Scale, level: Level): Constraint {
  const steps = gradeSteps(scale.system)
  const [from, to] = LEVEL_SPANS[scale.system][level]
  return spanOf(scale, steps.indexOf(from), to === null ? steps.length - 1 : steps.indexOf(to))
}

/** A grade standing on its own: a range of one. */
function bareGradeCandidate(scales: readonly Scale[]): Candidate {
  return {
    first: null,
    match(tokens, at) {
      const token = tokens[at]
      if (!token || !looksLikeAGrade(token)) return null
      const grade = readGrade(token, scales)
      if (!grade) return null

      // An alpine grade with no sign is its band: a climber who types `PD`
      // means PD-, PD or PD+, and a route graded PD+ is one they want.
      if (grade.scale.system === 'alpine' && !/[+-]$/u.test(grade.written)) {
        const steps = gradeSteps('alpine')
        const band = steps.map((s, i) => ({ s, i })).filter(({ s }) => s.replace(/[+-]$/u, '') === grade.written)
        if (band.length > 1) {
          return { length: 1, constraints: [spanOf(grade.scale, band[0]!.i, band[band.length - 1]!.i)] }
        }
      }

      return {
        length: 1,
        constraints: [{
          kind: 'grade', scale: grade.scale.system,
          min: grade.ordinal, max: grade.ordinal, written: grade.written,
        }],
      }
    },
  }
}

/**
 * Every reading of the line, in the order they are tried — the first that
 * matches at a position wins, which is what makes this longest-match.
 *
 * The written forms come first. They contain Italian the visitor typed on
 * purpose — `entro … km da …`, `fino a …`, `dal … al …`, `tra … e …`,
 * `dal … in su`, `sopra …`, `almeno …`, `sotto …` — and nothing else is
 * allowed to read the words inside them.
 *
 * Then the vocabulary, longest phrase first, and only then a bare grade. That
 * order settles the one collision this archive really produces: `PD` is the
 * province of Padova and `PD` is also a grade, and the row wins. A vocabulary
 * phrase is evidence that this archive holds something by that name and the
 * constraint it makes can return it; the grade reading is a guess about
 * notation, and one that would quietly add an activity constraint nobody typed.
 */
function candidatesOf(vocabulary: Vocabulary, scales: readonly Scale[]): Candidate[] {
  const phrases = vocabularyPhrases(vocabulary)
  const places = phrases.filter(p => p.rank === 1)

  return [
    ...NEAR_LEADS.map(lead => nearCandidate(places, lead)),
    ...NEARBY.map(words => nearbyCandidate(words, places)),
    ...gradeCandidates(scales),
    ...DRY_OPENINGS.map(dryCandidate),
    ...DRY_BARE.map(bareDryCandidate),
    ...LEVEL_WORDS.map(([level, it]) => levelCandidate(level, it)),
    ...phrases.map((phrase): Candidate => ({
      first: phrase.words[0]!,
      match: (tokens, at) => phraseMatches(phrase, tokens, at) && mayBePlace(phrase, tokens, at)
        ? { length: phrase.words.length, constraints: [phrase.make()] }
        : null,
    })),
    bareGradeCandidate(scales),
  ]
}

/**
 * The vocabulary again, forgiving one slip per word. Tried only at a position
 * where nothing matched exactly, so a typo can never outvote a name the
 * visitor spelt right, and never reads the words inside a written form.
 */
function forgivingCandidatesOf(vocabulary: Vocabulary, places: boolean): Candidate[] {
  // A place is forgiven a slip only when asked for. With every comune in the
  // archive, ordinary words sit one letter from a town — `Cerco` from Cervo,
  // `Cresta` from Cressa — so Find reads the line exactly first, and forgives a
  // town's spelling only when that found nothing, saying it reread the line.
  return vocabularyPhrases(vocabulary).filter(p => places || p.rank !== 1).map((phrase): Candidate => ({
    first: null,
    match: (tokens, at) => phraseMatches(phrase, tokens, at, true) && mayBePlace(phrase, tokens, at)
        && !(phrase.rank === 1 && WORDS_FIRST.has(tokens[at]!.norm))
      ? { length: phrase.words.length, constraints: [phrase.make()] }
      : null,
  }))
}

// ---------------------------------------------------------------------------
// Parsing
// ---------------------------------------------------------------------------

/** Two constraints saying the same thing are one question asked twice. */
function keyOf(c: Constraint): string {
  switch (c.kind) {
    case 'activity': return `activity:${c.id}`
    case 'place':    return `place:${c.id}`
    case 'near':     return `near:${c.placeId}:${c.withinKm}`
    case 'grade':    return `grade:${c.scale}:${c.min}:${c.max}`
    case 'fact':     return `fact:${c.activities.join('+')}:${c.id}:${c.match}:${String(c.value)}`
    case 'dry':      return `dry:${c.days}`
    case 'name':     return `name:${c.text}`
  }
}

/**
 * The words that ask rather than say: `Cerco`, `vorrei`. The sentence opens
 * with one of its own, so a visitor who types the sentence types it too.
 */
const ASKING = new Set(['cerco', 'cerca', 'cercavo', 'cerchiamo', 'voglio', 'vorrei', 'trova', 'trovami',
  'mostrami', 'dammi', 'consigliami', 'consigliatemi', 'suggeriscimi', 'dove', 'posso', 'possiamo', 'potrei',
  'fare', 'andare', 'serve', 'mi', 'ci', 'qualcosa', 'qualche', 'c\'e', 'ce', 'esiste', 'esistono'])

/**
 * The small words that join a sentence together — `una falesia a Susa`. Kept
 * inside a name (`Viso di Vallanta` is matched a word at a time, and the
 * read-back should be the name typed), dropped when they are all that is left.
 */
const JOINING = new Set(['un', 'una', 'uno', 'il', 'lo', 'la', 'i', 'gli', 'le', 'l\'',
  'di', 'del', 'della', 'dei', 'delle', 'degli', 'a', 'al', 'alla', 'ai', 'alle', 'ad',
  'da', 'dal', 'dalla', 'in', 'nel', 'nella', 'nei', 'nelle', 'per', 'con', 'e', 'o',
  'qualche', 'delle', 'qui', 'li', 'la', 'zona', 'vicino'])

/** What is left unread, without the words that only ask or join. */
function withoutFiller(words: readonly string[]): string[] {
  const kept = words.filter(w => !ASKING.has(fold(w)))
  return kept.length > 0 && kept.every(w => JOINING.has(fold(w))) ? [] : kept
}

/**
 * A typed line, read against what the archive actually holds.
 *
 * Total by construction. The line is whatever a stranger typed into a search
 * box, so nothing here throws and nothing unread is dropped: every word this
 * cannot read survives in the `name` constraint, and an empty line is a legitimate
 * question that constrains nothing.
 *
 * Matching is tolerant — case, typographic apostrophes, accents, punctuation
 * and runs of whitespace all fold, and a word of five letters or more may carry
 * one slip where nothing matches it exactly (a place's name only with
 * `forgivePlaces`) — but `name` carries the visitor's own
 * spelling, because that is the string a route name is matched against and the
 * string the sentence reads back.
 *
 * The result is ordered as the sentence is written: an inferred activity opens
 * it, then everything in the order the line named it, then the free text last.
 */
export function parse(
  line: string, vocabulary: Vocabulary, opts: { readonly forgivePlaces?: boolean } = {},
): readonly Constraint[] {
  const tokens = tokenise(line)
  const scales = scalesOf(vocabulary)
  const candidates = candidatesOf(vocabulary, scales)
  const forgiving = forgivingCandidatesOf(vocabulary, opts.forgivePlaces ?? false)

  const found: Constraint[] = []
  const leftover: string[] = []
  const levels: { level: Level; text: string }[] = []

  let i = 0
  while (i < tokens.length) {
    const token = tokens[i]!

    let match: Match | null = null
    for (const candidate of candidates) {
      if (candidate.first !== null && candidate.first !== token.norm) continue
      match = candidate.match(tokens, i)
      if (match) break
    }
    if (!match) {
      for (const candidate of forgiving) {
        match = candidate.match(tokens, i)
        if (match) break
      }
    }

    // The guard on `length` is what makes this loop terminate rather than a
    // convention every candidate is trusted to keep.
    if (match && match.length >= 1) {
      found.push(...match.constraints)
      if (match.level) levels.push(match.level)
      i += match.length
    } else {
      leftover.push(token.text)
      i++
    }
  }

  // A fact phrase belongs to one activity, and a grade to one scale. Under an
  // activity the visitor typed that does not declare it, it cannot apply, and
  // it is dropped without a word: this is what the sentence posts when its
  // activity menu moves from falesie to alpinismo with the crag's grade and
  // features set, and the visitor who changed the activity expects them gone,
  // not reported. Kept, a grade would compare a sport ordinal against nothing
  // and empty the list; dropped, the sentence offers the new activity's own.
  //
  // Every activity in `found` was typed; an inferred one is only added below.
  const typedActivities = new Set(found.flatMap(c => (c.kind === 'activity' ? [c.id] : [])))
  const applicable = found.flatMap((c): Constraint[] => {
    if (typedActivities.size === 0) return [c]
    if (c.kind === 'fact') {
      // A shared phrase narrows to the activities the visitor typed.
      const activities = c.activities.filter(a => typedActivities.has(a))
      return activities.length === 0 ? [] : [{ ...c, activities }]
    }
    if (c.kind === 'grade') {
      return [...typedActivities].some(id => gradeSystemsOfActivity(id).includes(c.scale)) ? [c] : []
    }
    return [c]
  })

  // A level becomes grades on the one scale the line is about: the typed
  // activity's, else the one scale a typed grade is on, else the archive's only
  // scale. Where that is not one scale, "facile" is a question about nothing in
  // particular, and it stays on screen, unread.
  const lineSystems = typedActivities.size > 0
    ? new Set([...typedActivities].flatMap(id => gradeSystemsOfActivity(id)))
    : new Set(applicable.flatMap(c => (c.kind === 'grade' ? [c.scale] : [])))
  const levelScale = lineSystems.size === 1
    ? scales.find(s => lineSystems.has(s.system))
    : lineSystems.size === 0 && scales.length === 1 ? scales[0] : undefined
  for (const l of levels) {
    if (levelScale) applicable.push(levelSpan(levelScale, l.level))
    else leftover.push(l.text)
  }

  const seen = new Set<string>()
  const constraints = applicable.filter(c => {
    const key = keyOf(c)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })

  // A grade names its scale, and a scale names its activity; a fact phrase
  // names its activity outright — but only where the visitor did not name one
  // first. An activity that was typed is never overridden by one deduced.
  //
  // And only where everything deduced agrees. `dal AD al 6a` reads as two
  // grades on two scales, and a grade on one activity's scale beside a fact of
  // another's names two activities; picking either would be a coin toss that
  // becomes a *hard* constraint, so nothing is inferred and the sentence shows
  // the visitor what they asked for instead.
  if (typedActivities.size === 0) {
    const systems = new Set(constraints.filter(c => c.kind === 'grade').map(c => c.scale))
    const implied = new Map<string, { id: string; label: string }>()
    if (systems.size === 1) {
      const scale = scales.find(s => systems.has(s.system))
      if (scale?.activity) implied.set(scale.activity.id, scale.activity)
    }
    for (const c of constraints) {
      // A phrase several activities share names none of them.
      if (c.kind !== 'fact' || c.activities.length !== 1) continue
      const entry = vocabulary.activities.find(a => a.id === c.activities[0])
      if (entry) implied.set(entry.id, entry)
    }
    const only = implied.size === 1 ? [...implied.values()][0]! : null
    if (systems.size <= 1 && only) {
      constraints.unshift({ kind: 'activity', id: only.id, label: only.label, inferred: true })
    }
  }

  const unread = withoutFiller(leftover)
  if (unread.length > 0) constraints.push({ kind: 'name', text: unread.join(' ') })

  return constraints
}

// ---------------------------------------------------------------------------
// What Find's sentence can offer, read off the registry

/**
 * The grade scale an activity declares, on a fact or on its parts — the steps
 * Find's sentence offers in its grade clause. Null for an activity with none.
 */
export function gradeSystemOfActivity(id: string): GradeSystem | null {
  return gradeSystemsOfActivity(id)[0] ?? null
}

/** Every grade scale an activity declares, on its facts or its parts, in declaration order. */
function gradeSystemsOfActivity(id: string): readonly GradeSystem[] {
  const schema = ACTIVITIES[id]
  if (!schema) return []
  const found: GradeSystem[] = []
  for (const def of [...schema.facts, ...(schema.parts?.fields ?? [])]) {
    const system = systemOf(def.quantity)
    if (system !== null && !found.includes(system)) found.push(system)
  }
  return found
}

/**
 * Every phrase an activity's facts declare for Find, each in its first
 * spelling, with the fact and value it asks about and the fact's own label —
 * what the sentence offers to add, so that every offer is one the parser reads
 * back, and the menu can group the offers under the fact they belong to.
 */
export function findPhrasesOf(id: string): readonly {
  readonly fact: string; readonly label: string; readonly match: 'is' | 'includes' | 'atMost' | 'atLeast'
  readonly value: string | boolean | number; readonly written: string
}[] {
  const schema = ACTIVITIES[id]
  if (!schema) return []
  return schema.facts.flatMap(def =>
    (def.find ?? []).flatMap(f => (f.it[0] === undefined ? [] : [{
      fact: def.id, label: def.label.it, match: f.match, value: f.value, written: f.it[0],
    }])))
}

/**
 * A set of constraints written back as one line the parser reads — the line
 * the sentence's slots would post. Used where Find rereads a question itself
 * and has to say what it asked instead.
 */
export function lineOf(constraints: readonly Constraint[]): string {
  const pieces: string[] = []
  for (const c of constraints) if (c.kind === 'activity') pieces.push(c.label)
  for (const c of constraints) if (c.kind === 'fact') pieces.push(c.written)
  for (const c of constraints) if (c.kind === 'grade') pieces.push(c.written)
  for (const c of constraints) if (c.kind === 'dry') pieces.push(c.written)
  for (const c of constraints) {
    if (c.kind === 'near') pieces.push(`entro ${c.withinKm} km da ${c.placeName}`)
    if (c.kind === 'place') pieces.push(c.name)
  }
  for (const c of constraints) if (c.kind === 'name') pieces.push(c.text)
  return pieces.join(' ')
}
