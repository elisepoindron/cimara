/**
 * The sentences the open line shows in grey, one after another, after "Cerco".
 *
 * The first is the field's own placeholder, so the line still offers one with
 * no JavaScript; line-examples.js turns the rest in, word by word. Each is a
 * line this archive answers, read whole: an example that returns nothing, or
 * that finds something only because Find set words aside, teaches the visitor
 * that the field does not work. None asks for weather or conditions, which
 * change by the day. There is one per activity the archive has routes for, so
 * the line does not read as a crag search, and each asks a different kind of
 * thing: a height, a season, a face, a place, a grade. A test holds every
 * one of these to it.
 *
 * These are candidates: the line shows the first `SHOWN_EXAMPLES` that this
 * archive answers as typed (`exampleLines`, src/app/server.ts), so an archive
 * with no alpinismo never opens on a promise it cannot keep. The ones after
 * the first five are there for such an archive.
 */
export const LINE_EXAMPLES: readonly string[] = [
  'vie di alpinismo sopra i 3000 m',
  'falesie d’inverno',
  'escursioni esposte a sud',
  'gite di sci alpinismo vicino a Sestriere',
  'vie multipitch fino al 6a',
  'falesie esposte a sud',
  'escursioni sopra i 2000 m',
  'vie ferrate',
  'falesie fino al 6a',
  'escursioni d’estate',
]

/** How many examples the line turns through. */
export const SHOWN_EXAMPLES = 5
