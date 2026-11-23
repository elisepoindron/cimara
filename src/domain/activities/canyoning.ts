import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * A canyon descent. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const canyoning = defineActivity({
  id: 'canyoning',
  label: { it: 'Canyoning' },
  plural: { it: 'forre' },
  singular: { it: 'forra' },
  also: { it: ['torrentismo'] },
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
