import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * A river run by canoe or kayak. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const canoa = defineActivity({
  id: 'canoa',
  label: { it: 'Canoa' },
  plural: { it: 'discese in canoa' },
  singular: { it: 'discesa in canoa' },
  also: { it: ['kayak', 'canoismo', 'rafting'] },
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
