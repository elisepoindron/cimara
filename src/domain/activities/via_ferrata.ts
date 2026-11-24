import { aspect, metres, minutes, text } from '../quantity.ts'
import {
  defineActivity, description, distance, fact, findAspect, furniture, prose, rowFact,
} from '../registry.ts'

/**
 * A via ferrata. Its header is what a ferrata guide gives: the difficulty on
 * the usual scale (F, PD, D, TD, ED, with `+` or `-`), the climb, where the
 * cable starts and where it ends, which way the wall faces and the walk to the
 * first cable. The scale is text until Find needs to compare it. Every fact is
 * optional. Where it has a track, Come arrivare draws it as a hike's.
 */
export const viaFerrata = defineActivity({
  id: 'via_ferrata',
  label: { it: 'Via ferrata' },
  plural: { it: 'vie ferrate' },
  singular: { it: 'via ferrata' },
  also: { it: ['ferrata', 'ferrate'] },
  facts: [
    fact('difficolta',    text,    { label: { it: 'Difficoltà' },     optional: true }),
    fact('dislivello',    metres,  { label: { it: 'Dislivello' },     optional: true }),
    fact('partenza',      metres,  { label: { it: 'Quota attacco' },  optional: true }),
    fact('vetta',         metres,  { label: { it: 'Quota massima' },  optional: true }),
    fact('esposizione',   aspect,  { label: { it: 'Esposizione' },    optional: true, find: findAspect() }),
    fact('avvicinamento', minutes, { label: { it: 'Avvicinamento' },  optional: true }),
  ],
  row: [rowFact('dislivello', 'dplus'), rowFact('esposizione', 'esp'), rowFact('avvicinamento', 'avv'), distance()],
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
    furniture('parcheggio', 'Come arrivare', 'traccia'),
  ],
  current: { days: 14 },
})
