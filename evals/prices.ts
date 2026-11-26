import type { Usage } from './client.ts'

/**
 * What a call costs, in US dollars per million tokens, from Anthropic's price
 * list as it stood on 2026-11-03. Prices change: check
 * https://platform.claude.com/docs/en/about-claude/pricing before trusting a
 * total, and update this table and its date together.
 *
 * A cache write is billed at 1.25 times the input price (the five-minute
 * cache). The app sets no cache breakpoint today, so the two cache columns
 * stay at zero; they are here so a change that adds caching shows its saving.
 */
export const PRICES_AS_OF = '2026-11-03'

interface Price {
  readonly input: number
  readonly output: number
  readonly cacheRead: number
  /** Above this many input tokens in one request, the `long` prices apply. */
  readonly longFrom?: number
  readonly long?: { readonly input: number; readonly output: number }
}

const PRICES: Readonly<Record<string, Price>> = {
  // Cache reads for Haiku 5.5 are not on the list this was taken from; a tenth
  // of the input price, as on every other model, is assumed.
  'claude-haiku-5-5': { input: 0.10, output: 0.50, cacheRead: 0.01, longFrom: 100_000, long: { input: 0.50, output: 2.50 } },
  'claude-sonnet-5-5': { input: 2, output: 10, cacheRead: 0.10 },
  'claude-sonnet-5': { input: 2, output: 10, cacheRead: 0.20 },
  'claude-opus-5-5': { input: 4, output: 20, cacheRead: 0.20 },
}

/** The cost of one call, or null for a model this table does not price. */
export function costOf(model: string, usage: Usage): number | null {
  const p = PRICES[model]
  if (!p) return null
  const write = usage.cache_creation_input_tokens ?? 0
  const read = usage.cache_read_input_tokens ?? 0
  const allInput = usage.input_tokens + write + read
  const long = p.long && p.longFrom !== undefined && allInput > p.longFrom ? p.long : null
  const input = long?.input ?? p.input
  const output = long?.output ?? p.output
  return (usage.input_tokens * input + write * input * 1.25 + read * p.cacheRead + usage.output_tokens * output) / 1e6
}
