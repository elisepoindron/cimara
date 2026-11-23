import Anthropic from '@anthropic-ai/sdk'
import { PLACES, type ReadRow, type ReadSentence, type RowReading } from './reading.ts'

/**
 * Haiku reads one row's prose and says where each sentence belongs.
 *
 * Loaded by the command line only, when `ANTHROPIC_API_KEY` is set; nothing a
 * test imports reaches this file. What it returns is checked before anything
 * is moved (`checkProposal`), and most of it is never moved at all — see
 * a design study, measured on the four real crags:
 * about a tenth of a cent a crag, right on the road against the walk, and
 * right three times in eleven on everything else.
 */
const MODEL = 'claude-haiku-5-5'

/**
 * Names the question below. The reading cache is keyed by it, so changing a
 * word of the prompt or the schema means bumping this, and every row is read
 * again on the next run.
 */
export const IMPORT_READING_VERSION = 'import-reading-1'

/** Enough for a long crag page's sentences, copied out, plus low-effort thinking. */
const MAX_TOKENS = 16000

/** A row waits this long, then is read by the rule alone. */
const TIMEOUT_MS = 60_000

const SYSTEM = 'You sort the prose of one route or crag page from an Italian online archive of climbing '
  + 'and mountaineering, into the parts of a new archive. Its authors typed into whichever box was at hand, '
  + 'so a box\'s name says where they typed, not what they wrote. The boxes are:\n'
  + '- note: remarks on the place as a whole; on a crag, its presentation.\n'
  + '- storia: its history.\n'
  + '- descrizione: the route itself, how it goes from bottom to top.\n'
  + '- discesa: the way down after the climb, on foot or by abseil.\n'
  + '- materiale: the gear to bring.\n'
  + '- avvicinamento: from the car to the start of the climb.\n'
  + 'Split every box into sentences and give each sentence one place:\n'
  + '- here: it fits the box it was typed in, as described above. Most sentences do: choose another place '
  + 'only when a reader would plainly look for the sentence somewhere else.\n'
  + '- road: driving to the start: roads, villages, turns, motorway exits.\n'
  + '- parking: where to leave the car, or a warning about parking.\n'
  + '- walk: the way on foot from the car to the climb.\n'
  + '- presentation: what the place is like in general (rock, style, bolting as it is now, gear, advice).\n'
  + '- history: who opened or bolted it, when, who came back. Not how it is today.\n'
  + '- services: toilets, water, shops, a bar, a refuge.\n'
  + '- fact: the sentence states one measurable fact a guidebook keeps as a field (when the shade comes, '
  + 'the rock, the season, the walk time). Name it in "fact".\n'
  + 'Inside the "avvicinamento" box, every sentence is road, parking or walk. '
  + 'Copy each sentence exactly as written, character for character, typos and odd spacing included. '
  + 'Never rewrite, merge, shorten or translate. Every sentence of every box appears once, in order.'

function schemaFor(boxes: readonly string[]) {
  return {
    type: 'object',
    properties: {
      sentences: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            from: { type: 'string', enum: [...boxes] },
            text: { type: 'string' },
            to: { type: 'string', enum: [...PLACES] },
            fact: { type: 'string' },
          },
          required: ['from', 'text', 'to'],
          additionalProperties: false,
        },
      },
    },
    required: ['sentences'],
    additionalProperties: false,
  } as const
}

export function realReadRow(apiKey: string): ReadRow {
  const client = new Anthropic({ apiKey })

  return async (boxes): Promise<RowReading | null> => {
    const ids = Object.keys(boxes)
    if (ids.length === 0) return null
    const response = await client.messages.create({
      model: MODEL,
      max_tokens: MAX_TOKENS,
      system: SYSTEM,
      messages: [{ role: 'user', content: ids.map(id => `[${id}]\n${boxes[id]}`).join('\n\n') }],
      output_config: { effort: 'low', format: { type: 'json_schema', schema: schemaFor(ids) } },
    }, { timeout: TIMEOUT_MS })

    // A refusal or a cut-off answer is no reading, and says so by being null.
    const block = response.content.find(b => b.type === 'text')
    if (response.stop_reason !== 'end_turn' || block?.type !== 'text') return null
    const parsed = JSON.parse(block.text) as { sentences?: unknown }
    if (!Array.isArray(parsed.sentences)) return null
    const sentences: ReadSentence[] = []
    for (const s of parsed.sentences as Record<string, unknown>[]) {
      if (typeof s.from !== 'string' || typeof s.text !== 'string'
          || !(PLACES as readonly string[]).includes(s.to as string)) return null
      sentences.push({ from: s.from, text: s.text, to: s.to as ReadSentence['to'],
        ...(typeof s.fact === 'string' && s.fact.trim() !== '' ? { fact: s.fact.trim() } : {}) })
    }
    return { sentences }
  }
}
