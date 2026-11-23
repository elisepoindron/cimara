import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * Whatever the other eighteen do not hold. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const altro = defineActivity({
  id: 'altro',
  label: { it: 'Altro' },
  plural: { it: 'altre attività' },
  singular: { it: 'altra attività' },
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
