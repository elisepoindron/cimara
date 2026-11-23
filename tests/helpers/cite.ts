import type { CallModelCitation, CallModelInput } from '../../src/app/synthesis.ts'

/**
 * A fake model's citations: each report id quoted with its whole words, which
 * ground. An id that was never sent is quoted with words that are nowhere, so
 * the grounding drops it as it would drop a real model's invented reference.
 */
export function citing(input: CallModelInput, ids: readonly string[]): CallModelCitation[] {
  return ids.map(id => ({ reportId: id, quote: input.reports.find(r => r.id === id)?.words ?? 'parole inventate' }))
}
