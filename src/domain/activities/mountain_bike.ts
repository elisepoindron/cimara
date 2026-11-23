import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * A mountain-bike ride. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const mountainBike = defineActivity({
  id: 'mountain_bike',
  label: { it: 'Mountain bike' },
  plural: { it: 'giri in mountain bike' },
  singular: { it: 'giro in mountain bike' },
  also: { it: ['mtb', 'bici da montagna', 'enduro'] },
  facts: [],
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
  ],
  current: { days: 14 },
})
