import { metres, text } from '../quantity.ts'
import {
  defineActivity, description, distance, fact, furniture, prose, rowFact,
} from '../registry.ts'

/**
 * A mountain-bike ride. Its header is what a ride sheet gives: the difficulty
 * on the CAI scale (TC, MC, BC, OC, EC, the climb's grade first, then the
 * descent's, as `MC/BC`), the climb, where it starts and how high it goes.
 * The scale is text until Find needs to compare it. Every fact is optional.
 * Where it has a track, Come arrivare draws it as a hike's.
 */
export const mountainBike = defineActivity({
  id: 'mountain_bike',
  label: { it: 'Mountain bike' },
  plural: { it: 'giri in mountain bike' },
  singular: { it: 'giro in mountain bike' },
  also: { it: ['mtb', 'bici da montagna', 'enduro'] },
  facts: [
    fact('difficolta',  text,   { label: { it: 'Difficoltà' },     optional: true }),
    fact('dislivello',  metres, { label: { it: 'Dislivello' },     optional: true }),
    fact('partenza',    metres, { label: { it: 'Quota partenza' }, optional: true }),
    fact('vetta',       metres, { label: { it: 'Quota massima' },  optional: true }),
  ],
  row: [rowFact('dislivello', 'dplus'), distance()],
  access: [
    fact('localita_partenza', text, { label: { it: 'Località di partenza' }, optional: true }),
    fact('come_arrivare',     text, { label: { it: 'Come arrivare' },        optional: true }),
  ],
  document: [
    description(),
    furniture('relazioni',     'Cosa dicono le relazioni', 'relazioni'),
    prose    ('avvicinamento', 'Avvicinamento', 'tail'),
    furniture('storico',       'Storico e fonti'),
    furniture('altri',         'Altri itinerari'),
  ],
  rail: [
    furniture('condizioni', 'Condizioni', 'condizioni'),
    furniture('vicine',     'Itinerari vicini', 'vicine'),
    furniture('foto',       'Foto', 'foto'),
    furniture('parcheggio', 'Come arrivare', 'traccia'),
  ],
  current: { days: 14 },
})
