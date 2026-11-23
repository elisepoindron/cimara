import type { Db } from './open.ts'

export interface ThemeCount {
  readonly label: string
  readonly count: number
  /** The reports this theme was counted from: `count` is their number. Empty on
   * a row saved before migration 022, which kept only the count. */
  readonly reportIds: readonly string[]
  /** For each report in `reportIds`, the words in it that back the theme, exactly
   * as its author wrote them. Absent on a row saved before quotes were asked for,
   * which `itinerariesAwaitingSynthesis` then treats as due. */
  readonly quotes?: Readonly<Record<string, string>>
  /** How many people raised it: distinct accounts, an unsigned report counting
   * as one voice of its own. Two reports by the same climber are one voice, so
   * a theme is shared from two voices, not two reports. A theme one voice raised
   * still shows on that report; only shared ones are counted on the route page.
   * Absent on a row from an earlier reading, which counted reports. */
  readonly voices?: number
}

/**
 * Something about the route that changed for good, as one or more reports say
 * it: a short name for the change, whether it asks for care (`attenzione`: a
 * flake gone, a chain torn out, trees across the path) or is simply news
 * (`novita`: routes added, new bolts, a path re-marked), and for each report
 * the sentence that says it, exactly as its author wrote it. The kind says
 * whether to watch out, never whether the place is any good.
 */
export interface Flag {
  readonly label: string
  readonly kind: FlagKind
  readonly reportIds: readonly string[]
  readonly quotes: Readonly<Record<string, string>>
}

export type FlagKind = 'attenzione' | 'novita'

export const FLAG_KINDS: readonly FlagKind[] = ['attenzione', 'novita']

/** How a flag was saved before it had a name and a kind: one report, one sentence. */
interface OldFlag { reportId: string; sentence: string }

/**
 * An old flag reads back as what the page showed for it then — its sentence,
 * in the colour of care — until the backfill reads the route again.
 */
function flagOf(saved: Flag | OldFlag): Flag {
  if ('label' in saved) return saved
  return {
    label: saved.sentence, kind: 'attenzione',
    reportIds: [saved.reportId], quotes: { [saved.reportId]: saved.sentence },
  }
}

export interface SynthesisRow {
  readonly itineraryId: string
  readonly generatedAt: string
  readonly reportCount: number
  readonly themes: readonly ThemeCount[]
  readonly flags: readonly Flag[]
  /** Which reading made it: see migration 023. */
  readonly reading: number
  /** Every report this reading has gone through, with or without a point in it. */
  readonly readIds: readonly string[]
}

export type NewSynthesis = Omit<SynthesisRow, 'itineraryId'>

/**
 * One row per itinerary — a regeneration replaces it outright, it never adds to it.
 *
 * Except by an older one. Two gite filed seconds apart each start a
 * fire-and-forget regeneration, and the model calls can finish in either
 * order: without the `where`, the one that read fewer reports could land last
 * and leave a staler snapshot standing until the next filing corrected it.
 * Timestamps are ISO-8601, so a string comparison is a chronological one.
 */
export async function saveSynthesis(db: Db, itineraryId: string, data: NewSynthesis): Promise<void> {
  await db.run(
    `insert into synthesis (itinerary_id, generated_at, report_count, themes, flags, reading, read_ids)
     values (?, ?, ?, ?, ?, ?, ?)
     on conflict (itinerary_id) do update set
       generated_at = excluded.generated_at,
       report_count = excluded.report_count,
       themes = excluded.themes,
       flags = excluded.flags,
       reading = excluded.reading,
       read_ids = excluded.read_ids
     where excluded.generated_at >= synthesis.generated_at`,
    [itineraryId, data.generatedAt, data.reportCount, JSON.stringify(data.themes),
     JSON.stringify(data.flags), data.reading, JSON.stringify(data.readIds)])
}

interface RawSynthesis {
  itinerary_id: string; generated_at: string; report_count: number; themes: string; flags: string
  reading: number; read_ids: string
}

/** `null` before the first successful generation — the caller renders nothing then. */
export async function synthesisFor(db: Db, itineraryId: string): Promise<SynthesisRow | null> {
  const row = await db.get<RawSynthesis>(
    `select itinerary_id, generated_at, report_count, themes, flags, reading, read_ids
     from synthesis where itinerary_id = ?`,
    [itineraryId])
  if (!row) return null

  return {
    itineraryId: row.itinerary_id, generatedAt: row.generated_at, reportCount: row.report_count,
    // A theme saved before migration 022 has a count and no ids.
    themes: (JSON.parse(row.themes) as Array<Omit<ThemeCount, 'reportIds'> & { reportIds?: string[] }>)
      .map(t => ({
        label: t.label, count: t.count, reportIds: t.reportIds ?? [],
        ...(t.quotes ? { quotes: t.quotes } : {}),
        ...(t.voices !== undefined ? { voices: t.voices } : {}),
      })),
    flags: (JSON.parse(row.flags) as (Flag | OldFlag)[]).map(flagOf),
    reading: row.reading,
    readIds: JSON.parse(row.read_ids) as string[],
  }
}

/**
 * Every route with a standing report the synthesis has not read: no synthesis
 * yet, a report filed or imported since (one not in `read_ids`), or a synthesis
 * an earlier reading made (`reading` below the one asked for), which is read
 * again whole. Counted the way `giteFor` counts: a gita nobody withdrew, or an
 * unsigned report a seed or an import brought in.
 *
 * Filing reads its own report as it happens; this is for everything that
 * reaches the archive another way, and for a filing whose reading failed. A
 * route whose reports were all read, with or without a theme in them, is not
 * asked again until a new one arrives.
 */
export async function itinerariesAwaitingSynthesis(
  db: Db, reading: number,
): Promise<{ id: string; name: string }[]> {
  return db.all<{ id: string; name: string }>(
    `with report as (
       select g.id, g.itinerary_id from gita g
       where not exists (select 1 from retraction r where r.gita_id = g.id)
       union all
       select ir.id, ir.itinerary_id from imported_report ir
     ),
     standing as (
       select itinerary_id, count(*) as n from report group by itinerary_id
     )
     select i.id, i.name
     from standing s
     join itinerary i on i.id = s.itinerary_id
     left join synthesis sy on sy.itinerary_id = s.itinerary_id
     where sy.itinerary_id is null
        or sy.reading < ?
        or exists (select 1 from report r
                   where r.itinerary_id = s.itinerary_id
                     and r.id not in (select value from json_each(sy.read_ids)))
     order by s.n desc, i.id`, [reading])
}
