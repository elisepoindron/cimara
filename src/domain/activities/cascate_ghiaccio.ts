import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * A frozen waterfall. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const cascateGhiaccio = defineActivity({
  id: 'cascate_ghiaccio',
  label: { it: 'Cascate di ghiaccio' },
  plural: { it: 'cascate di ghiaccio' },
  singular: { it: 'cascata di ghiaccio' },
  also: { it: ['cascata', 'cascate', 'ghiaccio verticale', 'dry tooling'] },
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
  skyFigures: ['zero_termico', 'neve_fresca'],
})
