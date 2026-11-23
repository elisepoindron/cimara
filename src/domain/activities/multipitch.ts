import { aspect, count, gradeScale, metres, minutes, protection, text } from '../quantity.ts'
import {
  defineActivity, description, fact, findAspect, findAtMost, findIs, furniture, generated, parts, pointsPanel, prose, rowFact, rowGrades,
} from '../registry.ts'

/**
 * A multi-pitch rock climb — not a crag, which is falesia. Its header is what
 * the source archive's own sheet records: the hardest move and the hardest you cannot
 * pull through on the bolts, both on the sport scale, how long the climbing
 * is, where it starts and which way it faces. The two grades together are the
 * route's grade range, which is what Find filters on.
 */
export const multipitch = defineActivity({
  id: 'multipitch',
  label: { it: 'Multipitch' },
  plural: { it: 'vie multipitch' },
  singular: { it: 'via multipitch' },
  also: { it: ['arrampicata', 'via lunga', 'vie lunghe', 'più tiri', 'arrampicata trad'] },
  facts: [
    fact('grado_max',          gradeScale('sport'), { label: { it: 'Grado massimo' },           optional: true }),
    fact('grado_obbligatorio', gradeScale('sport'), { label: { it: 'Difficoltà obbligatoria' }, optional: true }),
    fact('sviluppo',           metres,              { label: { it: 'Sviluppo' },                optional: true }),
    // How many pitches, as the sheet says it. Recorded rather than counted from
    // the pitch list, because most routes say "sei tiri" long before anybody
    // writes each pitch down; where both exist the seed holds them equal.
    fact('tiri',               count,               { label: { it: 'Tiri' },                    optional: true }),
    fact('quota_base',         metres,              { label: { it: 'Quota base' },              optional: true }),
    fact('esposizione',        aspect,              { label: { it: 'Esposizione' },             optional: true, find: findAspect() }),
    // The walk from the car to the first pitch, where the words give a time.
    // Optional, as on a crag: turning a path's description into minutes would
    // be inventing a walking speed.
    fact('avvicinamento',      minutes,             { label: { it: 'Avvicinamento' },           optional: true,
      find: [findAtMost(15, 'con avvicinamento entro 15 min', 'avvicinamento entro 15 min', 'avvicinamento breve',
               'con avvicinamento breve', 'avvicinamento corto', 'con avvicinamento corto', 'poco avvicinamento'),
             findAtMost(30, 'con avvicinamento entro 30 min', 'avvicinamento entro 30 min'),
             findAtMost(60, 'con avvicinamento entro un\'ora', 'avvicinamento entro un\'ora', 'entro un\'ora di avvicinamento')] }),
    // What gear the route asks for, as one of three.
    fact('protezione',         protection,          { label: { it: 'Protezione' },              optional: true,
      find: [findIs('spittata', 'spittate', 'spittata', 'a spit', 'tutte a spit', 'senza friend', 'plaisir'),
             findIs('da_integrare', 'da integrare', 'spittate da integrare', 'con qualche friend'),
             findIs('trad', 'trad', 'in trad', 'da proteggere', 'a protezioni mobili', 'con protezioni mobili')] }),
  ],
  // What a Find row shows (find-row-multipitch-options.html, R1 with I2): both
  // grades behind one difficulty icon, each named, then the pitches under the
  // crag's route-count icon, the length and the walk-in.
  row: [
    rowGrades(['grado_obbligatorio', 'obbligatoria'], ['grado_max', 'max']),
    rowFact('tiri', 'vie'), rowFact('sviluppo', 'dplus'), rowFact('avvicinamento', 'avv'),
  ],
  access: [
    fact('localita_partenza', text, { label: { it: 'Località di partenza' }, optional: true }),
    fact('come_arrivare',     text, { label: { it: 'Come arrivare' },        optional: true }),
  ],
  // The descent, the gear and the notes run on inside the description, each
  // behind a small label, as on every activity: a few lines each, they read as
  // part of what the route is, not as sections of their own. The way down comes
  // first, straight after the way up.
  document: [
    description({ before: [{ id: 'discesa', it: 'Discesa' }, { id: 'materiale', it: 'Materiale' }] }),
    // The pitches straight after the description, before what people say:
    // the route first.
    generated('tiri',          'Tiri', 'tiri'),
    furniture('relazioni',     'Cosa dicono le relazioni', 'relazioni'),
    prose    ('avvicinamento', 'Avvicinamento', 'tail'),
    furniture('storico',       'Storico e fonti'),
    furniture('altri',         'Altri itinerari'),
  ],
  rail: [
    furniture('condizioni', 'Condizioni', 'condizioni'),
    furniture('vicine',     'Itinerari vicini', 'vicine'),
    furniture('foto',       'Foto', 'foto'),
    // As on a crag: the parking and where the climbing starts, named over a
    // map of both with the walk between them, then the road in words. A
    // multi-pitch's own point is its attacco.
    pointsPanel('parcheggio', 'Come arrivare', { it: 'Attacco', of: 'dell\u2019attacco' }),
  ],
  // A route's pitches, in the order they are climbed. Every field is optional:
  // the source archive writes "(6b, 30 m)" after most pitches and nothing after some.
  // A pitch graded between two (6b+/6c) keeps both, the upper in grado_fino.
  parts: parts({
    label: { it: 'Tiri' },
    each: { it: 'tiro' },
    ordered: true,
    optional: true,
    fields: [
      fact('grado',       gradeScale('sport'), { label: { it: 'Grado' },       optional: true }),
      fact('grado_fino',  gradeScale('sport'), { label: { it: 'Grado fino a' }, optional: true }),
      fact('lunghezza',   metres,              { label: { it: 'Lunghezza' },   optional: true }),
      fact('descrizione', text,                { label: { it: 'Descrizione' }, optional: true }),
    ],
  }),
  current: { days: 14 },
})
