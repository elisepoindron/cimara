import { createHash } from 'node:crypto'
import type { ModelClient } from '../src/app/ai-client.ts'

/**
 * Model clients for the evals: one that records what the real API answers,
 * one that answers from a recording. Both stand where the SDK's client stands
 * (`ModelClient`), so the prompts, the calls and the parsing under test are the
 * app's own, untouched.
 *
 * A recorded call is found again by a hash of the whole request — model,
 * prompt, words sent, schema. Change a word of a prompt and the hash changes:
 * the recording no longer answers, and the case is reported stale instead of
 * being scored on what an older prompt was answered.
 */

/** What the app reads of a response, and what it was billed: nothing more is kept. */
export interface RecordedMessage {
  readonly model: string
  readonly stop_reason: string | null
  readonly content: readonly { type: 'text'; text: string }[]
  readonly usage: Usage
}

export interface Usage {
  readonly input_tokens: number
  readonly output_tokens: number
  readonly cache_creation_input_tokens?: number | null
  readonly cache_read_input_tokens?: number | null
}

export interface RecordedCall {
  readonly key: string
  /** The reading's step it was made in: `read`, `merge` or `check`. */
  readonly step: string
  readonly model: string
  readonly latencyMs: number
  readonly message: RecordedMessage
}

export function requestKey(params: unknown): string {
  return createHash('sha256').update(JSON.stringify(params)).digest('hex').slice(0, 32)
}

/** A response cut down to what is kept: the text blocks (no thinking), the stop and the usage. */
export function slim(message: {
  model: string; stop_reason: string | null; content: readonly { type: string; text?: string }[]; usage: Usage
}): RecordedMessage {
  const u = message.usage
  return {
    model: message.model,
    stop_reason: message.stop_reason,
    content: message.content.flatMap(b => (b.type === 'text' ? [{ type: 'text' as const, text: b.text ?? '' }] : [])),
    usage: {
      input_tokens: u.input_tokens, output_tokens: u.output_tokens,
      cache_creation_input_tokens: u.cache_creation_input_tokens ?? 0,
      cache_read_input_tokens: u.cache_read_input_tokens ?? 0,
    },
  }
}

/** Raised for a request no recording answers. */
export class NotRecorded extends Error {
  readonly key: string
  constructor(key: string) {
    super(`eval: no recorded answer for request ${key} (the prompt changed?); record again with --live`)
    this.key = key
  }
}

type Send = (params: Record<string, unknown>) => Promise<RecordedMessage>

/** The three calls the app makes, all answered by `send`. */
function clientOver(send: Send): ModelClient {
  const stream = (params: Record<string, unknown>) => ({ finalMessage: () => send(params) })
  const create = (params: Record<string, unknown>) => send(params)
  return { messages: { stream, create }, beta: { messages: { stream, create } } } as unknown as ModelClient
}

/** Answers from one recorded run; a request it holds no answer for is listed in `misses` and fails. */
export function replayingClient(calls: readonly RecordedCall[], misses: string[]): ModelClient {
  const byKey = new Map(calls.map(c => [c.key, c.message]))
  return clientOver(async params => {
    const key = requestKey(params)
    const message = byKey.get(key)
    if (!message) {
      misses.push(key)
      throw new NotRecorded(key)
    }
    return message
  })
}

/**
 * The real client, each call it makes timed and handed to `record`. `step`
 * says which step of the reading is running: the steps follow one another, so
 * every call made while one runs belongs to it.
 */
export function recordingClient(real: ModelClient, record: (call: RecordedCall) => void, step: () => string): ModelClient {
  const timed = (path: 'messages' | 'beta', how: 'stream' | 'create'): Send => async params => {
    const started = performance.now()
    const api = (path === 'beta' ? real.beta.messages : real.messages) as unknown as {
      stream: (p: unknown) => { finalMessage: () => Promise<Parameters<typeof slim>[0]> }
      create: (p: unknown) => Promise<Parameters<typeof slim>[0]>
    }
    const message = how === 'stream' ? await api.stream(params).finalMessage() : await api.create(params)
    const kept = slim(message)
    record({ key: requestKey(params), step: step(), model: kept.model, latencyMs: Math.round(performance.now() - started), message: kept })
    return kept
  }
  return {
    messages: { stream: (p: Record<string, unknown>) => ({ finalMessage: () => timed('messages', 'stream')(p) }), create: timed('messages', 'create') },
    beta: { messages: { stream: (p: Record<string, unknown>) => ({ finalMessage: () => timed('beta', 'stream')(p) }), create: timed('beta', 'create') } },
  } as unknown as ModelClient
}
