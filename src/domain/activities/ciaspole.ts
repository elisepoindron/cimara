import { defineActivity, description, furniture, prose } from '../registry.ts'

/**
 * A snowshoe walk. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const ciaspole = defineActivity({
  id: 'ciaspole',
  label: { it: 'Ciaspole' },
  plural: { it: 'gite in ciaspole' },
  singular: { it: 'gita in ciaspole' },
  also: { it: ['ciaspolata', 'ciaspolate', 'racchette da neve'] },
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
