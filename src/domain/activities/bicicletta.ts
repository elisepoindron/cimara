import { defineActivity, description, furniture, generated, prose } from '../registry.ts'

/**
 * A road ride. Prose only for now: no header facts, no parts. It exists so the
 * archive can hold, find and count it; facts come when someone argues for them.
 */
export const bicicletta = defineActivity({
  id: 'bicicletta',
  label: { it: 'Bicicletta' },
  plural: { it: 'giri in bicicletta' },
  singular: { it: 'giro in bicicletta' },
  also: { it: ['bici da strada', 'cicloturismo', 'ciclismo', 'bici'] },
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
