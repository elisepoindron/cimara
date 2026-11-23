/**
 * A foreign archive's "Avvicinamento" is often not an approach at all.
 *
 * The source archive has one box for everything between the main road and the foot of
 * the wall, and its authors fill it as they would tell a friend: how to drive
 * to the village, where to leave the car, then the path. This archive keeps
 * those apart — `Accesso e parcheggio` is the road and the car, `Avvicinamento`
 * is on foot — so an importer cannot take the source's section for granted.
 *
 * The rule reads sentence by sentence and never rewrites one. The walk starts
 * at the first sentence that is plainly on foot (a path, a trace, "a piedi",
 * minutes "dall'auto" or "dal parcheggio"). What comes before it is access only
 * if something in it is about driving or parking; otherwise the text was an
 * approach all along and is left where it was. A text with nothing on foot in
 * it and something about parking is all access. Nothing is dropped and nothing
 * is added: the two halves, read one after the other, are the text.
 */

export interface SortedApproach {
  /** The drive (and, from the rule, the parking with it), as written, or null when there was none. */
  readonly access: string | null
  /**
   * Where to leave the car, apart from the road. Only a model's reading tells
   * the two apart; the word rule leaves the parking in `access`.
   */
  readonly parking: string | null
  /** The walk, as written, or null when the text held none. */
  readonly approach: string | null
}

/** On foot. "dal parcheggio" and "dall'auto" are where a walk starts, not a drive. */
const ON_FOOT = new RegExp([
  String.raw`\bsentiero\b`, String.raw`\bsentierino\b`, String.raw`\btraccia\b`, String.raw`\bmulattiera\b`,
  String.raw`\ba piedi\b`, String.raw`\bimbocca(?:re|te)?\b`, String.raw`\bpietraia\b`,
  String.raw`\bdal(?:l['’])?\s*(?:parcheggio|piazzale|auto|macchina)\b`,
].join('|'), 'i')

/** The road and the car. */
const BY_ROAD = new RegExp([
  String.raw`\bparchegg`, String.raw`\bposteggi`, String.raw`\bvettura\b`, String.raw`\bauto\b`,
  String.raw`\bmacchina\b`, String.raw`\bautostrada\b`, String.raw`\bcasello\b`, String.raw`\buscita\b`,
].join('|'), 'i')

/**
 * Sentences as substrings of the text, each keeping its own punctuation and the
 * space after it, so joining them gives the text back exactly.
 */
export function sentences(text: string): string[] {
  const out: string[] = []
  const end = /[.!?]+["»”)]*\s+/g
  let start = 0
  for (let m = end.exec(text); m !== null; m = end.exec(text)) {
    const stop = m.index + m[0].length
    out.push(text.slice(start, stop))
    start = stop
  }
  if (start < text.length) out.push(text.slice(start))
  return out
}

const orNull = (s: string): string | null => (s.trim() === '' ? null : s.trim())

export function sortApproach(text: string): SortedApproach {
  const parts = sentences(text)
  const walkAt = parts.findIndex(s => ON_FOOT.test(s))
  const before = walkAt === -1 ? parts : parts.slice(0, walkAt)
  if (!before.some(s => BY_ROAD.test(s))) return { access: null, parking: null, approach: orNull(text) }
  return {
    access: orNull(before.join('')),
    parking: null,
    approach: walkAt === -1 ? null : orNull(parts.slice(walkAt).join('')),
  }
}

/** Where a model says one sentence of an approach belongs. */
export type ApproachPlace = 'road' | 'parking' | 'walk'

export interface ProposedSentence {
  readonly text: string
  readonly to: ApproachPlace
}

/**
 * A model's reading of an approach, kept only if it is the text cut up and
 * nothing else.
 *
 * The sentences must be found in the text, in order, each exactly as written,
 * with nothing but spaces between them and nothing left over: no word
 * rewritten, dropped, added or moved. And the road and the parking must all
 * come before the walk, since nobody parks after setting off on foot — a
 * reading that says otherwise has misread the text. Either way the answer is
 * null, and the caller falls back to `sortApproach`.
 */
export function checkProposal(text: string, proposal: readonly ProposedSentence[]): SortedApproach | null {
  let at = 0
  let walking = false
  let previous: ApproachPlace | null = null
  // Each place's words, built from the text itself: two sentences next to each
  // other keep whatever stood between them (one space, two, or none at all —
  // "CADUTI.Salire"); only sentences that were apart are joined by a space.
  const built: Record<ApproachPlace, string> = { road: '', parking: '', walk: '' }
  for (const s of proposal) {
    const sentence = s.text.trim()
    if (sentence === '') return null
    const found = text.indexOf(sentence, at)
    if (found === -1 || text.slice(at, found).trim() !== '') return null
    if (s.to === 'walk') walking = true
    else if (walking) return null
    const before = built[s.to] === '' ? '' : previous === s.to ? text.slice(at, found) : ' '
    built[s.to] += before + sentence
    at = found + sentence.length
    previous = s.to
  }
  if (text.slice(at).trim() !== '' || proposal.length === 0) return null
  const orNone = (s: string) => (s === '' ? null : s)
  return { access: orNone(built.road), parking: orNone(built.parking), approach: orNone(built.walk) }
}
