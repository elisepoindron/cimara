import { defineActivity, description, furniture, generated, prose } from '../registry.ts'

/**
 * A cross-country ski trail. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const fondo = defineActivity({
  id: 'fondo',
  label: { it: 'Fondo' },
  plural: { it: 'piste di fondo' },
  singular: { it: 'pista di fondo' },
  also: { it: ['sci di fondo', 'sci nordico', 'skating'] },
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
  skyFigures: ['neve_fresca'],
})
