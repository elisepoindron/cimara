import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * Off-piste skiing reached from the lifts. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const freeride = defineActivity({
  id: 'freeride',
  label: { it: 'Freeride' },
  plural: { it: 'itinerari freeride' },
  singular: { it: 'itinerario freeride' },
  also: { it: ['fuoripista', 'fuori pista'] },
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
