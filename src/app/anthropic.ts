import Anthropic from '@anthropic-ai/sdk'
import { callModelWith, rewriteLineWith } from './ai-client.ts'
import type { CallModel } from './synthesis.ts'
import type { RewriteLine } from './find.ts'

/**
 * The one place the SDK's client is made. Kept apart from `ai-client.ts` so
 * the prompts and the parsing of answers can be loaded without the package:
 * the evals replay recorded answers through them with nothing installed.
 */

/** Wired once at server startup from `ANTHROPIC_API_KEY`. Never constructed in a test. */
export function realCallModel(apiKey: string): CallModel {
  return callModelWith(new Anthropic({ apiKey }))
}

/** Wired once at server startup from `ANTHROPIC_API_KEY`. Never constructed in a test. */
export function realRewriteLine(apiKey: string): RewriteLine {
  return rewriteLineWith(new Anthropic({ apiKey }))
}
