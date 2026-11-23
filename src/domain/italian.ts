/** "1 via" but "9 vie". Italian agreement is the renderer's job, not the data's. */
export function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
}

const WORDS = ['zero', 'un', 'due', 'tre', 'quattro', 'cinque',
               'sei', 'sette', 'otto', 'nove']

/**
 * Small numbers are written out, as `evidence.html` does — "Tre itinerari",
 * not "3 itinerari". Ten and above stay as figures.
 */
export function inWords(n: number): string {
  return WORDS[n] ?? String(n)
}

/**
 * "Basso, Centrale e Scuola" — Italian lists take "e", not a comma, before the last.
 *
 * When an item contains a comma of its own the list separates on semicolons
 * instead. Route names in this archive are feature-then-route — "Monviso, Cresta
 * Est" — so a comma-separated list of them reads as twice as many routes.
 */
export function listInItalian(items: readonly string[]): string {
  if (items.length <= 1) return items[0] ?? ''

  const last = items[items.length - 1]!
  const rest = items.slice(0, -1)

  return items.some(i => i.includes(','))
    ? `${rest.join('; ')}; e ${last}`
    : `${rest.join(', ')} e ${last}`
}

const DATE_FORMAT = new Intl.DateTimeFormat('it-IT', {
  day: 'numeric', month: 'long', timeZone: 'UTC',
})

/**
 * "9 settembre" — the day and month a climber reads. Always formatted in UTC,
 * so the same stored instant reads the same date regardless of the server's
 * local timezone; every date this project stores is a bare UTC day or an
 * ISO instant, never a local wall-clock time.
 */
export function formatDate(iso: string): string {
  return DATE_FORMAT.format(new Date(iso))
}

const SHORT_MONTHS = ['gen', 'feb', 'mar', 'apr', 'mag', 'giu', 'lug', 'ago', 'set', 'ott', 'nov', 'dic']

/**
 * "12 set" — the day and month, short enough to stand large in a narrow column,
 * as the reports page dates each slip. Its own list rather than `Intl`'s short
 * month, which varies with the ICU data Node was built with. UTC, as `formatDate`.
 */
export function formatShortDate(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCDate()} ${SHORT_MONTHS[d.getUTCMonth()]}`
}

/** The year a date falls in, in UTC. */
export function yearOf(iso: string): string {
  return String(new Date(iso).getUTCFullYear())
}

const MS_PER_DAY = 86_400_000

/** Which UTC day a date falls on, as a whole number of days since the epoch. */
function utcDay(d: Date): number {
  return Math.floor(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()) / MS_PER_DAY)
}

/**
 * "oggi", "ieri", "due giorni fa" — how a climber dates a report they are
 * reading now. Deliberately not `Intl.RelativeTimeFormat`, which says "l’altro
 * ieri" at two days and "3 giorni fa" at three: this archive writes small
 * numbers out (see `inWords`) and `evidence.html`'s specimen reads "due giorni
 * fa".
 *
 * The difference is in whole UTC days, not in milliseconds, so "ieri" means the
 * calendar day before rather than any 24-hour span — the same UTC discipline
 * `formatDate` keeps. A date in the future reads "oggi": validation should stop
 * one ever reaching here, and this function cannot assume it did.
 */
export function formatRelativeDays(iso: string, now: Date): string {
  const then = new Date(iso)
  // Not reachable from the validated write path, and this is a renderer: a date
  // nothing can read should not take a page down, and "NaN giorni fa" is worse
  // than saying nothing — it reads as a number.
  if (Number.isNaN(then.getTime())) return 'data sconosciuta'

  const days = utcDay(now) - utcDay(then)
  if (days <= 0) return 'oggi'
  if (days === 1) return 'ieri'
  return `${inWords(days)} giorni fa`
}

/**
 * How old something is, in the unit a climber would use for it: "sei giorni",
 * "un mese", "quattro mesi", "un anno". Written to be read after "ha" —
 * `evidence.html`'s specimen is "L’ultima osservazione ha quattro mesi."
 *
 * Deliberately not `formatRelativeDays`, which would say "126 giorni fa" for
 * the same gap. Nobody counts a season in days, and "nessuna da tre mesi" is
 * there to say that a gap is longer than anyone has noticed. Small
 * numbers stay written out, as everywhere else here.
 *
 * Months are whole calendar months, so a report of the 12th is one month old on
 * the 12th of the next month and thirty days old on the 11th. Beyond twelve it
 * reads in years, because "quattordici mesi" is not how anyone says it.
 */
export function formatAge(iso: string, now: Date): string {
  const then = new Date(iso)
  const months = wholeMonths(then, now)

  if (months >= 12) {
    const years = Math.floor(months / 12)
    return `${inWords(years)} ann${years === 1 ? 'o' : 'i'}`
  }
  if (months >= 1) return `${inWords(months)} mes${months === 1 ? 'e' : 'i'}`

  const days = utcDay(now) - utcDay(then)
  return days < 1 ? 'meno di un giorno' : `${inWords(days)} giorn${days === 1 ? 'o' : 'i'}`
}

/** Whole calendar months from `then` to `now`: the 12th to the 11th of the next is none. */
function wholeMonths(then: Date, now: Date): number {
  let months = (now.getUTCFullYear() - then.getUTCFullYear()) * 12
    + (now.getUTCMonth() - then.getUTCMonth())
  if (now.getUTCDate() < then.getUTCDate()) months--
  return months
}

/** Days whose Italian names begin with a vowel: otto, undici, diciotto. */
const ELIDING_DAYS = new Set([8, 11, 18])

/**
 * "al 14 settembre", but "all’8 settembre" — the article elides before a day
 * whose name begins with a vowel. The first of the month is read "primo" and
 * takes the plain article like any consonant.
 *
 * Two prepositions, because the two dated groups of a `discordante` module read
 * "Fino all’11 settembre" and "Dal 14 settembre in poi".
 */
export function formatDateWithArticle(preposition: 'a' | 'da', iso: string): string {
  return ELIDING_DAYS.has(new Date(iso).getUTCDate())
    ? `${preposition}ll’${formatDate(iso)}`
    : `${preposition}l ${formatDate(iso)}`
}

/**
 * When something was, in the unit a climber would use: "ieri", "tre giorni fa"
 * within a month, then "quattro mesi fa", and past a year "un anno e tre mesi
 * fa" — the months kept, because a report from fourteen months ago and one from
 * twenty-three are not the same age, and "un anno fa" said both. A whole number
 * of years reads alone: "due anni fa". "L’ultima 1985 giorni fa" was the
 * arithmetic talking; nobody says it.
 *
 * `formatAge` keeps whole years only: it says how long a gap has lasted
 * ("nessuna da un anno"), where the months would be noise.
 */
export function formatAgo(iso: string, now: Date): string {
  const days = utcDay(now) - utcDay(new Date(iso))
  if (Number.isNaN(days) || days < 31) return formatRelativeDays(iso, now)

  const months = wholeMonths(new Date(iso), now)
  if (months < 12) return `${formatAge(iso, now)} fa`

  const years = Math.floor(months / 12)
  const rest = months % 12
  const y = `${inWords(years)} ann${years === 1 ? 'o' : 'i'}`
  return rest === 0 ? `${y} fa` : `${y} e ${inWords(rest)} mes${rest === 1 ? 'e' : 'i'} fa`
}
