import { defineActivity, description, furniture, generated, prose } from '../registry.ts'

/**
 * A steep ski descent. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const sciRipido = defineActivity({
  id: 'sci_ripido',
  label: { it: 'Sci ripido' },
  plural: { it: 'discese di sci ripido' },
  singular: { it: 'discesa di sci ripido' },
  also: { it: ['ripidi', 'sci estremo'] },
  facts: [],
  document: [
    description(),
    generated('profilo',       'Profilo', 'profilo'),
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
