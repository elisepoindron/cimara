import { defineActivity, description, furniture, generated, prose } from '../registry.ts'

/**
 * A trail run. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const trailRunning = defineActivity({
  id: 'trail_running',
  label: { it: 'Trail running' },
  plural: { it: 'percorsi di trail running' },
  singular: { it: 'percorso di trail running' },
  also: { it: ['trail', 'corsa in montagna', 'skyrunning'] },
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
  current: { days: 14 },
})
