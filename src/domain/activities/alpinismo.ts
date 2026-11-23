import { aspect, count, gradeScale, metres, protection, text } from '../quantity.ts'
import {
  defineActivity, description, distance, fact, findAspect, findAtLeast, findAtMost, findIs, furniture, generated, parts, prose,
  rowFact,
} from '../registry.ts'

/** An alpine route. Its facts are authored; its tiri, when it has any, are numbered. */
export const alpinismo = defineActivity({
  id: 'alpinismo',
  label: { it: 'Alpinismo' },
  plural: { it: 'vie di alpinismo' },
  singular: { it: 'via di alpinismo' },
  also: { it: ['via alpinistica', 'vie alpinistiche', 'alpinistica', 'alpinistiche', 'alpinistico',
               'salita alpinistica', 'salite alpinistiche', 'ascensione', 'ascensioni'] },
  facts: [
    // Optional: a route whose grade nobody ever recorded is a route this
    // archive should be able to hold. Everything else here defines the route.
    fact('difficolta',  gradeScale('alpine'),
         { label: { it: 'Difficoltà' }, optional: true }),
    // Find offers round figures, the way a climber asks: "sotto i 1000 m di
    // dislivello", "sopra i 3000". The first spelling of each is what the
    // sentence writes back and offers in its menu.
    fact('dislivello',  metres,               { label: { it: 'Dislivello' },
      find: [findAtMost(500, 'dislivello entro 500 m', 'con poco dislivello', 'poco dislivello',
                        'dislivello sotto i 500 m', 'meno di 500 m di dislivello'),
             findAtMost(1000, 'dislivello entro 1000 m', 'dislivello sotto i 1000 m', 'dislivello sotto 1000 m',
                        'meno di 1000 m di dislivello', 'sotto i 1000 m di dislivello'),
             findAtMost(1500, 'dislivello entro 1500 m', 'dislivello sotto i 1500 m', 'meno di 1500 m di dislivello')] }),
    fact('partenza',    metres,               { label: { it: 'Partenza' } }),
    fact('vetta',       metres,               { label: { it: 'Vetta' },
      find: [findAtLeast(3000, 'vetta sopra i 3000 m', 'sopra i 3000 m', 'oltre i 3000 m', 'sopra 3000 m',
                         'oltre 3000 m', 'sopra i 3000', 'oltre i 3000', 'vetta sopra 3000 m', 'vetta oltre i 3000 m', 'sopra i tremila', 'oltre i tremila'),
             findAtLeast(3500, 'vetta sopra i 3500 m', 'sopra i 3500 m', 'oltre i 3500 m', 'sopra 3500 m', 'oltre 3500 m', 'vetta sopra 3500 m',
                         'vetta oltre i 3500 m'),
             findAtLeast(4000, 'vetta sopra i 4000 m', 'sopra i 4000 m', 'oltre i 4000 m', 'vetta sopra 4000 m', 'un 4000', 'quattromila',
                         'i 4000')] }),
    fact('esposizione', aspect,               { label: { it: 'Esposizione' }, find: findAspect() }),
    fact('giorni',      count,                { label: { it: 'Giorni' },
      find: [findAtMost(1, 'in giornata', 'in un giorno', 'in una giornata', 'di un giorno')] }),
    // As on a multi-pitch: how many pitches, where the sheet counts them (a
    // rock route does, a snow couloir does not), and how the route is
    // protected, where its words say. Both optional and left out when unsaid.
    fact('tiri',        count,                { label: { it: 'Tiri' },        optional: true }),
    fact('protezione',  protection,           { label: { it: 'Protezione' },  optional: true,
      find: [findIs('spittata', 'spittate', 'spittata', 'a spit', 'tutte a spit'),
             findIs('da_integrare', 'da integrare', 'spittate da integrare'),
             findIs('trad', 'trad', 'in trad', 'da proteggere', 'a protezioni mobili', 'con protezioni mobili')] }),
  ],
  // What a Find row shows. find-screen.html draws it; the distance appears only
  // when the visitor named a place to measure from.
  row: [rowFact('difficolta', 'grado'), rowFact('dislivello', 'dplus'), rowFact('esposizione', 'esp'), distance()],
  access: [
    fact('localita_partenza', text, { label: { it: 'Località di partenza' }, optional: true }),
    fact('come_arrivare',     text, { label: { it: 'Come arrivare' },        optional: true }),
    fact('da_torino',         text, { label: { it: 'Da Torino' },            optional: true }),
    fact('parcheggio_nota',   text, { label: { it: 'Parcheggio' },           optional: true }),
  ],
  // The order route.html renders, not the order a guidebook would print:
  // `Descrizione` first, as on every activity, then what is drawn from the
  // route's data.
  document: [
    // The descent, the gear and the notes run on inside the description, each
    // behind a small label, as on a multi-pitch: part of what the route is
    // rather than sections of their own. The way down comes first, straight
    // after the way up.
    description({ before: [{ id: 'discesa', it: 'Discesa' }, { id: 'materiale', it: 'Materiale' }] }),
    generated('profilo',      'Profilo', 'profilo'),
    furniture('relazioni',    'Cosa dicono le relazioni', 'relazioni'),
    prose    ('avvicinamento','Avvicinamento', 'tail'),
    furniture('storico',      'Storico e fonti'),
    furniture('altri',        'Altri itinerari'),
  ],
  rail: [
    furniture('condizioni', 'Condizioni', 'condizioni'),
    furniture('vicine',     'Itinerari vicini', 'vicine'),
    furniture('foto',       'Foto', 'foto'),
    // drawn on every route, the points and map only where the parking is known
    furniture('parcheggio', 'Come arrivare', 'parcheggio'),
    furniture('appoggio',   'Punti d\u2019appoggio'),   // curly apostrophe, as on the page
    furniture('webcam',     'Webcam'),
  ],
  parts: parts({
    label: { it: 'Tiri' },
    each: { it: 'tiro' },
    ordered: true,
    optional: true,
    fields: [
      fact('numero', count,                { label: { it: 'Numero' } }),
      fact('grado',  gradeScale('alpine'), { label: { it: 'Grado' } }),
    ],
  }),
  current: { days: 7 },
  skyFigures: ['zero_termico', 'neve_fresca'],
})
