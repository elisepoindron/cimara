import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * A take-off site for free flight. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const voloLibero = defineActivity({
  id: 'volo_libero',
  label: { it: 'Volo libero' },
  plural: { it: 'decolli' },
  singular: { it: 'decollo' },
  also: { it: ['parapendio', 'deltaplano'] },
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
  current: { days: 7 },
})
