/**
 * A `CallModel` that reads nothing: it answers with readings written ahead of
 * time, beside the reports they read (Phase 4 of the public demo plan).
 *
 * The app's reading then does everything it does with a real model — grounds
 * every quote in the report's words, counts voices, keeps flags by kind — so a
 * recorded reading is held to the same standard as a live one. A report it has
 * no reading for is read as saying nothing.
 *
 * It has no `merge` and no `check`: the writer named each theme once and used
 * that name every time, so there is nothing to merge and no bundle to split.
 */
import type { CallModel, CallModelInput, CallModelResult } from '../app/synthesis.ts'

export interface RecordedReading {
  readonly themes?: readonly { label: string; quote: string }[]
  readonly flags?: readonly { label: string; kind: string; quote: string }[]
}

export function replayedModel(recorded: readonly { words: string; reading: RecordedReading | undefined }[]): CallModel {
  const byWords = new Map(recorded.map(r => [r.words, r.reading ?? {}]))
  return async (input: CallModelInput): Promise<CallModelResult> => {
    const themes = new Map<string, { reportId: string; quote: string }[]>()
    const flags = new Map<string, { label: string; kind: string; citations: { reportId: string; quote: string }[] }>()
    for (const report of input.reports) {
      const reading = byWords.get(report.words)
      if (!reading) continue
      for (const t of reading.themes ?? []) {
        const list = themes.get(t.label) ?? []
        list.push({ reportId: report.id, quote: t.quote })
        themes.set(t.label, list)
      }
      for (const f of reading.flags ?? []) {
        const key = `${f.kind}\u0000${f.label}`
        const flag = flags.get(key) ?? { label: f.label, kind: f.kind, citations: [] }
        flag.citations.push({ reportId: report.id, quote: f.quote })
        flags.set(key, flag)
      }
    }
    return {
      themes: [...themes].map(([label, citations]) => ({ label, citations })),
      flags: [...flags.values()],
    }
  }
}
