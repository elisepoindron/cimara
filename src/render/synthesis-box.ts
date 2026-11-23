import { CHANGES_NAMED_FROM, EVIDENCE_FLOOR, SHARED_VOICES } from '../app/synthesis.ts'
import type { Flag, FlagKind, SynthesisRow, ThemeCount } from '../db/synthesis.ts'
import { formatAgo, formatShortDate, inWords, yearOf } from '../domain/italian.ts'
import { html, join, type Html } from './html.ts'

export interface ReportsBoxOpts {
  /** Every standing report on the route, whether or not a synthesis read them. */
  readonly reportCount: number
  readonly lastReportAt?: string
  readonly now?: Date
  /**
   * When each standing report was observed, by id: what dates a change and
   * counts the reports behind it. A report missing here — withdrawn since the
   * reading — is not counted, and a change with none left is not shown.
   * Absent, the box shows no changes.
   */
  readonly reportDates?: ReadonlyMap<string, string>
  /** The route, for the way in to all its reports at the top of the box. */
  readonly itineraryId?: string
}

/**
 * The `.sum` box under `Cosa dicono le relazioni`, the same shape at every count:
 * first, on one line, how many reports there are, said large, and when the last
 * one was; then what they have in common; then what changed at the place.
 *
 * The total used to stand in a column beside the themes. With the changes under
 * them that column ran the height of three lists while counting only the first,
 * and on a phone it kept the lists to a third of the screen.
 *
 * The left side is the theme list once a synthesis has found themes. Before
 * that it is one sentence saying why there is no list — below the floor a
 * route has too few reports for anything to recur, and a section that showed
 * only a date and a link read as broken rather than young. No report is quoted
 * in its place: a report describes the route, it does not go stale, and
 * picking the latest one would say that it had.
 *
 * There is no lead paragraph and no footer. The lead read the list aloud; the
 * footer said the date in small capitals and then explained numbers that sit
 * under "40 relazioni in tutto". How many and when are the only two things
 * the page says about reports, so they stand on one line, and the list's
 * numbers carry a column head instead of a sentence.
 *
 * See a design study, option B.
 *
 * Under the themes, what changed at the place, care then news: see `changesOf`.
 *
 * Nothing in the box is a link but one: the way in to every report, at the
 * end of the count line, in a column of its own so that a zoomed page wraps
 * the date and never the button. It used to be a line of small capitals under
 * the box, read last and easy to miss, while each change was a link to a
 * single report. See a design study, F3.
 *
 * The synthesis keeps every theme, down to a point one person made; this box
 * lists only what is shared — raised by `SHARED_VOICES` people or more — and
 * the five raised most, as the mockup's list is five long. A point one person
 * made shows on their report, never in these numbers.
 */
export function reportsBox(synthesis: SynthesisRow | null, opts: ReportsBoxOpts): Html {
  const now = opts.now ?? new Date()
  const themes = opts.reportCount < EVIDENCE_FLOOR ? [] : (synthesis?.themes ?? [])
    .filter(shared)
    .sort((a, b) => b.count - a.count)
    .slice(0, LISTED)

  // With themes, the total is the number of reports they were counted out of —
  // the synthesis's own, which a report filed and not yet read can make differ
  // from the route's. Without, it is the route's.
  const total = themes.length > 0 ? synthesis!.reportCount : opts.reportCount
  const left = themes.length > 0
    ? html`<div class="sum__c">
              <div class="sum__h"><span>Citato</span><span>da quante relazioni</span></div>
              <div class="sum__l">${join(themes.map(t =>
                html`<div><b>${String(t.count)}</b><span>${t.label}</span></div>`), '')}</div>
            </div>`
    : html`<p class="sum__wait">${waiting(synthesis, opts.reportCount)}</p>`
  const changes = changesOf(synthesis, opts)

  return html`<div class="sum sum--stack">
          <div class="sum__top sum__top--go"><div class="sum__now"><b>${String(total)}</b><span>${total === 1 ? 'relazione in tutto' : 'relazioni in tutto'}</span>${
            last(opts.lastReportAt, opts.reportCount, now)}</div>${readAll(opts)}</div>
          ${left}${changes}
        </div>`
}

/** The one link in the box: every report on the route, by the route's own count. */
function readAll(opts: ReportsBoxOpts): Html | null {
  if (!opts.itineraryId || opts.reportCount === 0) return null
  const n = opts.reportCount
  return n === 1
    ? html`<a class="sum__go" href="/itinerario/${opts.itineraryId}/relazioni">Leggi la relazione</a>`
    : html`<a class="sum__go" href="/itinerario/${opts.itineraryId}/relazioni" aria-label="Leggi tutte le ${String(n)} relazioni">Leggile tutte</a>`
}

/** The mockup's own `.sum__l` list length. */
const LISTED = 5

/** How many changes of each kind the box names; the rest are on the reports page. */
const CHANGES_LISTED = 3

/** Care first, then news, as on the reports page. */
const CHANGE_TITLES: readonly [FlagKind, string][] = [['attenzione', 'Attenzione'], ['novita', 'Novità']]

interface DatedChange {
  readonly label: string
  readonly count: number
  readonly last: string
}

/**
 * What changed at the place, under the themes: for each kind, its changes by
 * short name — never a climber's sentence, which stays on the reports page —
 * with how many reports say it and when it was last said, the most recently
 * said first. A change goes stale where a theme does not, so the date stands
 * where a theme has nothing. The name is plain text: the reports are one
 * click away, at the top of the box. Three of each kind at most, and the number left over.
 *
 * Unlike the themes, a change is shown from the first report: one climber is
 * enough to say a chain is gone.
 *
 * See a design study, option A.
 */
function changesOf(synthesis: SynthesisRow | null, opts: ReportsBoxOpts): Html | null {
  const dates = opts.reportDates
  // A change saved by an earlier reading has no name, only its sentence; it
  // waits for the backfill to read the route again rather than show a sentence.
  if (!synthesis || !dates || synthesis.reading < CHANGES_NAMED_FROM) return null
  const groups = CHANGE_TITLES.flatMap(([kind, title]) => {
    const dated = synthesis.flags.filter(f => f.kind === kind).flatMap(f => datedOf(f, dates))
      .sort((a, b) => b.last.localeCompare(a.last) || b.count - a.count)
    if (dated.length === 0) return []
    const rest = dated.length - CHANGES_LISTED
    return [html`<div class="sum__g sum__g--${kind}">
                <div class="sum__gh"><span></span><span>${title}</span><span>ultima volta</span></div>
                ${join(dated.slice(0, CHANGES_LISTED).map(change), '')}${
                  rest > 0 ? html`<p class="sum__more">${rest === 1 ? 'E un’altra' : `E altre ${rest}`} nelle relazioni</p>` : null}
              </div>`]
  })
  return groups.length > 0 ? join(groups, '') : null
}

/** A change counted over the reports still standing, dated by the latest. */
function datedOf(f: Flag, dates: ReadonlyMap<string, string>): DatedChange[] {
  const standing = [...new Set(f.reportIds)].flatMap(id => {
    const at = dates.get(id)
    return at === undefined ? [] : [{ id, at }]
  })
  if (standing.length === 0 || f.label.trim() === '') return []
  const latest = standing.reduce((a, b) => (b.at > a.at ? b : a))
  return [{ label: f.label, count: standing.length, last: latest.at }]
}

function change(c: DatedChange): Html {
  return html`<div><b>${String(c.count)}</b><span>${c.label}</span><small>${
    `${formatShortDate(c.last)} ${yearOf(c.last)}`}</small></div>`
}

/** A theme saved by an earlier reading has no voices; it was kept only when two
 * reports shared it, so its count stands in. */
function shared(t: ThemeCount): boolean {
  return (t.voices ?? t.count) >= SHARED_VOICES
}

/** A reading ran and found nothing two people share. Said the same way on the
 * route page and above every report. */
export const NOTHING_SHARED = 'Nessun tema è ancora condiviso da più persone.'

/** Why the left side has no list. Three different reasons, said as what they are. */
function waiting(synthesis: SynthesisRow | null, reportCount: number): string {
  if (reportCount < EVIDENCE_FLOOR) {
    return `I temi che ritornano compaiono qui da ${inWords(EVIDENCE_FLOOR)} relazioni in su.`
  }
  // A synthesis ran and found nothing two people share: a result, not a wait.
  if (synthesis !== null) return NOTHING_SHARED
  return 'I temi che ritornano non sono ancora stati raccolti.'
}

/**
 * Beside the count, when the last report was: the calendar date, so the season
 * is read, then how long ago. "L’unica" when there is one report, which has
 * nothing to be the last of. Nothing without a date.
 */
function last(lastReportAt: string | undefined, reportCount: number, now: Date): Html | null {
  if (!lastReportAt) return null
  return html`<span class="sum__last"><em>${reportCount === 1 ? 'L’unica' : 'L’ultima'}</em> il <strong>${
    `${formatShortDate(lastReportAt)} ${yearOf(lastReportAt)}`}</strong>, <small>${formatAgo(lastReportAt, now)}</small></span>`
}
