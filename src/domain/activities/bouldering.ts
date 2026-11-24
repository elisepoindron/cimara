import { aspect, metres, minutes, rock, text } from '../quantity.ts'
import {
  defineActivity, description, distance, fact, findAspect, findRock, furniture, pointsPanel, prose, rowFact,
} from '../registry.ts'

/**
 * A boulder area. Its problems are told in words, not listed as parts; its
 * header is what a bouldering topo gives about the place: how high the blocks
 * sit, which way they face, the walk in and the rock. Every fact is optional.
 * Come arrivare draws the parking and the blocks as a crag's, with the walk
 * between them.
 */
export const bouldering = defineActivity({
  id: 'bouldering',
  label: { it: 'Bouldering' },
  plural: { it: 'blocchi' },
  singular: { it: 'blocco' },
  also: { it: ['boulder', 'sassismo', 'sassi'] },
  facts: [
    fact('quota_base',    metres,  { label: { it: 'Quota' },          optional: true }),
    fact('esposizione',   aspect,  { label: { it: 'Esposizione' },    optional: true, find: findAspect() }),
    fact('avvicinamento', minutes, { label: { it: 'Avvicinamento' },  optional: true }),
    fact('roccia',        rock,    { label: { it: 'Roccia' },         optional: true, find: findRock() }),
  ],
  row: [rowFact('esposizione', 'esp'), rowFact('avvicinamento', 'avv'), distance()],
  access: [
    fact('localita_partenza', text, { label: { it: 'Località di partenza' }, optional: true }),
    fact('come_arrivare',     text, { label: { it: 'Come arrivare' },        optional: true }),
    fact('parcheggio_nota',   text, { label: { it: 'Parcheggio' },           optional: true }),
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
    pointsPanel('parcheggio', 'Come arrivare', { it: 'Blocchi', of: 'dei blocchi' }),
  ],
  current: { days: 14 },
})
