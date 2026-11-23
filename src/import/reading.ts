/**
 * What a model said about one row's prose, before anything checks it.
 *
 * The importer asks once per row, in the run loop, and hands the answer to
 * `translate` the way it hands in the vocabulary, so translation stays pure:
 * the same row and the same reading always give the same answer. This file
 * imports no SDK — the client that fills it in is `ai-reading.ts`, which only
 * the command line loads, so `npm test` never needs the package.
 *
 * See a design study: the reading decides one thing,
 * where an approach's road and parking end and its walk begins, and only once
 * `checkProposal` has found it to be the text cut up and nothing else.
 * Everything else it says is a suggestion for the person running the import,
 * printed in the report and never applied.
 */

/**
 * Where a sentence belongs. `here` is the box it was typed in; `road`,
 * `parking` and `walk` are the three parts of an approach; the rest name
 * another part of the page, or a field the archive keeps (`fact`).
 */
export const PLACES = ['here', 'road', 'parking', 'walk', 'presentation', 'history', 'services', 'fact'] as const
export type Place = typeof PLACES[number]

export interface ReadSentence {
  /** The prose section it was typed in, by this archive's section id. */
  readonly from: string
  readonly text: string
  readonly to: Place
  /** For `fact`: which, in the model's words. Shown, never used to fill a field. */
  readonly fact?: string
}

export interface RowReading {
  readonly sentences: readonly ReadSentence[]
}

/** One row's prose sections, by section id, to the model's reading, or null when it could not read them. */
export type ReadRow = (boxes: Readonly<Record<string, string>>) => Promise<RowReading | null>

/** Something a model noticed and nobody acted on: for a person to look at. */
export interface Suggestion {
  readonly riga: number
  /** The source's column the sentence was typed in. */
  readonly field: string
  readonly sentence: string
  readonly to: Exclude<Place, 'here'>
  readonly fact?: string
}
