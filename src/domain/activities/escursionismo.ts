import { aspect, metres, text } from '../quantity.ts'
import {
  defineActivity, description, distance, fact, findAspect, furniture, rowFact,
} from '../registry.ts'

/**
 * A hike. Its header is what the source archive's own sheet records: the difficulty on
 * the hiking scale (T, E, EE, EEA), the climb, where it starts and how high it
 * goes. The scale is text until Find needs to compare it. Every fact is
 * optional, because a hike nobody measured is still a hike.
 */
export const escursionismo = defineActivity({
  id: 'escursionismo',
  label: { it: 'Escursionismo' },
  plural: { it: 'escursioni' },
  singular: { it: 'escursione' },
  also: { it: ['trekking', 'camminata', 'camminate', 'gita a piedi'] },
  facts: [
    fact('difficolta',  text,   { label: { it: 'Difficoltà' },     optional: true }),
    fact('dislivello',  metres, { label: { it: 'Dislivello' },     optional: true }),
    fact('partenza',    metres, { label: { it: 'Quota partenza' }, optional: true }),
    fact('vetta',       metres, { label: { it: 'Quota massima' },  optional: true }),
    fact('esposizione', aspect, { label: { it: 'Esposizione' },    optional: true, find: findAspect() }),
  ],
  row: [rowFact('dislivello', 'dplus'), rowFact('esposizione', 'esp'), distance()],
  access: [
    fact('localita_partenza', text, { label: { it: 'Località di partenza' }, optional: true }),
    fact('come_arrivare',     text, { label: { it: 'Come arrivare' },        optional: true }),
  ],
  document: [
    description(),
    furniture('relazioni',     'Cosa dicono le relazioni', 'relazioni'),
    furniture('storico',       'Storico e fonti'),
    furniture('altri',         'Altri itinerari'),
  ],
  rail: [
    furniture('condizioni', 'Condizioni', 'condizioni'),
    furniture('vicine',     'Itinerari vicini', 'vicine'),
    furniture('foto',       'Foto', 'foto'),
    // No parking point recorded for this activity. Where the route has a
    // track, the panel draws it as a crag's map draws its walk, from where it
    // starts to where it goes highest; without one, the road in words alone.
    furniture('parcheggio', 'Come arrivare', 'traccia'),
  ],
  current: { days: 14 },
})
