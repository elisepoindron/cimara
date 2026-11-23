import { aspect, metres, text } from '../quantity.ts'
import {
  defineActivity, description, distance, fact, findAspect, furniture, prose, rowFact,
} from '../registry.ts'

/**
 * A ski tour: up on skins, down on skis. Its header is what the source archive's own
 * sheet records — the ski difficulty (MS, BS, OS, with an A where it turns
 * alpine), the climb, the altitudes, the aspect, the kind of terrain. The ski
 * scale is text until Find needs to compare it.
 */
export const sciAlpinismo = defineActivity({
  id: 'sci_alpinismo',
  label: { it: 'Sci alpinismo' },
  plural: { it: 'gite di sci alpinismo' },
  singular: { it: 'gita di sci alpinismo' },
  also: { it: ['scialpinismo', 'sci-alpinismo', 'scialpinistica', 'scialpinistiche', 'gita scialpinistica', 'gite scialpinistiche'] },
  facts: [
    fact('difficolta',  text,   { label: { it: 'Difficoltà sciistica' }, optional: true }),
    fact('dislivello',  metres, { label: { it: 'Dislivello' },           optional: true }),
    fact('partenza',    metres, { label: { it: 'Quota partenza' },       optional: true }),
    fact('vetta',       metres, { label: { it: 'Quota massima' },        optional: true }),
    fact('esposizione', aspect, { label: { it: 'Esposizione' },          optional: true, find: findAspect() }),
    fact('tipologia',   text,   { label: { it: 'Tipologia' },            optional: true }),
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
    // no parking point recorded for this activity: the road in words alone
    furniture('parcheggio', 'Come arrivare', 'strada'),
  ],
  current: { days: 7 },
  skyFigures: ['zero_termico', 'neve_fresca'],
})
