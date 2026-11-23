import {
  aspect, boolean, count, gradeScale, metres, minutes, rangeOf, rock, seasons, stars, text, timeOfDay, wallAngles,
} from '../quantity.ts'
import {
  countParts, defineActivity, fact, findAspect, findAtLeast, findAtMost, findIncludes, findIs, findRock, fromParts,
  description, furniture, generated, histogram, parts, prose, rowFact,
} from '../registry.ts'

/** A crag. Three of its facts are computed from its vie, which sectors may group. */
export const falesia = defineActivity({
  id: 'falesia',
  label: { it: 'Falesia' },
  plural: { it: 'falesie' },
  also: { it: ['arrampicata sportiva', 'arrampicare', 'sportiva', 'climbing', 'crag',
               'monotiri', 'monotiro'] },
  facts: [
    fact('gradi',         rangeOf(gradeScale('sport')), { label: { it: 'Gradi' },        derived: fromParts('grado') }),
    fact('vie',           count,                        { label: { it: 'Vie' },          derived: countParts(),
      find: [findAtLeast(10, 'con almeno 10 vie', 'almeno 10 vie'), findAtLeast(20, 'con almeno 20 vie', 'almeno 20 vie',
               'con tante vie', 'con molte vie', 'tante vie', 'molte vie'),
             findAtLeast(50, 'con almeno 50 vie', 'almeno 50 vie')] }),
    fact('esposizione',   aspect,                       { label: { it: 'Esposizione' }, find: findAspect() }),
    // When the wall goes into shade is a fact about its shape, not about the
    // day anybody visited. It moves with the seasons, though: a south wall
    // loses the sun in early afternoon in July and can keep it until dusk in
    // December. So it is a span, earliest to latest, never one clock time.
    fact('ombra_dalle',   rangeOf(timeOfDay),           { label: { it: 'Ombra dalle' }, optional: true }),
    fact('quota_base',    metres,                       { label: { it: 'Quota base' } }),
    // Optional: plenty of topos give the walk-in as a distance ("300 m di
    // sentiero") or not at all, and turning metres into minutes here would be
    // inventing a walking speed. Where it is absent the strip shows a dash and
    // the crag map, given a trail, estimates one and says so (walkMinutes).
    // Find's "entro 10 min" does not match a crag that never said.
    fact('avvicinamento', minutes,                      { label: { it: 'Avvicinamento' },
      optional: true, whenAbsent: 'dash',
      find: [findAtMost(10, 'con avvicinamento entro 10 min', 'avvicinamento entro 10 min', 'avvicinamento entro 10 minuti',
               'avvicinamento breve', 'con avvicinamento breve', 'avvicinamento corto', 'con avvicinamento corto',
               'poco avvicinamento', 'con poco avvicinamento', 'senza avvicinamento', 'vicino alla macchina',
               'vicina alla macchina', 'vicino all\'auto', 'vicina all\'auto'),
             findAtMost(20, 'con avvicinamento entro 20 min', 'avvicinamento entro 20 min', 'avvicinamento entro 20 minuti'),
             findAtMost(30, 'con avvicinamento entro 30 min', 'avvicinamento entro 30 min', 'avvicinamento entro 30 minuti')] }),
    fact('riparato_dal_vento', boolean,
      { label: { it: 'Riparato dal vento' }, optional: true }),
    // What a printed guidebook's side column says about a crag, as facts the
    // archive can hold. All optional — most of the archive has never recorded
    // them — and all dashed when absent, so a reader can see nobody has said.
    // See its design spec.
    // A set, since most crags mix angles: "su placca" finds every crag with
    // slabs, whatever else it has.
    fact('parete',         wallAngles, { label: { it: 'Parete' },        optional: true, whenAbsent: 'dash',
      find: [findIncludes('placca', 'su placca', 'placca', 'placche', 'di placca'),
             findIncludes('verticale', 'verticali', 'verticale', 'su verticale'),
             findIncludes('strapiombante', 'strapiombanti', 'strapiombante', 'strapiombo', 'in strapiombo'),
             findIncludes('tetto', 'con tetti', 'tetti', 'con tetto')] }),
    // What the wall is made of. A climber chooses a crag by it as much as by
    // its angle — friction on granite, pockets in limestone.
    fact('roccia',         rock,      { label: { it: 'Roccia' },         optional: true, whenAbsent: 'dash',
      find: findRock() }),
    fact('stagione',       seasons,   { label: { it: 'Stagione' },       optional: true, whenAbsent: 'dash',
      // The adjective first, since the sentence reads "Cerco falesie estive";
      // then the season itself, which is how most people type it.
      find: [findIncludes('primavera', 'primaverile', 'primaverili', 'in primavera', 'primavera'),
             findIncludes('estate', 'estiva', 'estive', 'in estate', 'd\'estate', 'estate'),
             findIncludes('autunno', 'autunnale', 'autunnali', 'in autunno', 'autunno'),
             findIncludes('inverno', 'invernale', 'invernali', 'in inverno', 'd\'inverno', 'inverno')] }),
    // Sheltered first: the first spelling is the one the sentence offers, and
    // "Cerco falesie con la pioggia" read as looking for rain, not for a roof.
    // The older spellings stay, so whoever types them is still understood.
    fact('con_la_pioggia', boolean,   { label: { it: 'Con la pioggia' }, optional: true, whenAbsent: 'dash',
      find: [findIs(true, 'al riparo dalla pioggia', 'riparate dalla pioggia', 'riparata dalla pioggia',
                    'con la pioggia', 'quando piove', 'anche con la pioggia', 'se piove', 'al coperto')] }),
    fact('per_famiglie',   boolean,   { label: { it: 'Per famiglie' },   optional: true, whenAbsent: 'dash',
      find: [findIs(true, 'per famiglie', 'con bambini', 'con i bambini', 'per bambini', 'per i bambini',
                    'adatta ai bambini', 'adatte ai bambini', 'adatta alle famiglie', 'adatte alle famiglie',
                    'con la famiglia')] }),
    // Opinions, not measurements: drawn in the rail's Giudizi, not the strip.
    // The parking rating is voto_parcheggio because "parcheggio" is already the
    // parking panel's id and parcheggio_nota its prose.
    fact('bellezza',        stars, { label: { it: 'Bellezza' },     optional: true, whenAbsent: 'dash', placement: 'giudizi' }),
    fact('chiodatura',      stars, { label: { it: 'Chiodatura' },   optional: true, whenAbsent: 'dash', placement: 'giudizi' }),
    fact('tranquillita',    stars, { label: { it: 'Tranquillità' }, optional: true, whenAbsent: 'dash', placement: 'giudizi' }),
    fact('comodita',        stars, { label: { it: 'Comodità' },     optional: true, whenAbsent: 'dash', placement: 'giudizi' }),
    fact('voto_parcheggio', stars, { label: { it: 'Parcheggio' },   optional: true, whenAbsent: 'dash', placement: 'giudizi' }),
  ],
  // What a Find row shows: where the vie sit, how many, which way the wall
  // faces, and how long the walk in is. find-falesia.html draws it.
  row: [histogram('grado'), rowFact('vie', 'vie'), rowFact('esposizione', 'esp'), rowFact('avvicinamento', 'avv')],
  access: [
    fact('localita_partenza', text, { label: { it: 'Località di partenza' }, optional: true }),
    fact('come_arrivare',     text, { label: { it: 'Come arrivare' },        optional: true }),
    fact('da_torino',         text, { label: { it: 'Da Torino' },            optional: true }),
    fact('parcheggio_nota',   text, { label: { it: 'Parcheggio' },           optional: true }),
  ],
  // No descent, no gear list. Two generated sections instead, both from the vie.
  // What the relazioni say sits between them, not after the list of vie: a big
  // crag lists a hundred climbs, and the synthesis would end up a few screens
  // down, where nobody reads it. The crag's words open the page, as on every
  // activity, and the grade chart follows them: `Descrizione` first, then what
  // is drawn from the route's data. On a crag the description is its note, since
  // the source archive keeps no description for one.
  // It is one voice, not a report, so it is never inside the box. Where the source archive also has a crag's
  // history (who bolted it, when, who came back), it runs on behind a small
  // label, stored as `storia` — not `storico`, which is the furniture section
  // further down.
  document: [
    description({ after: [{ id: 'storia', it: 'Storico' }] }),
    generated  ('gradi',        'Ripartizione dei gradi', 'gradi'),
    furniture  ('relazioni',    'Cosa dicono le relazioni', 'relazioni'),
    generated  ('settori',      'Settori e vie', 'settori'),
    prose      ('avvicinamento','Avvicinamento', 'tail'),
    furniture  ('storico',      'Storico e fonti'),
    furniture  ('altri',        'Altri itinerari'),
  ],
  // No nearby crags in the rail: the parking map already pins every crag
  // within 40 km, and a list of the few that share this one's aspect and
  // altitude within 5 km showed on some pages and not others.
  rail: [
    furniture('condizioni', 'Condizioni', 'condizioni'),
    // The photos come before the way there, so a long road pushes nothing
    // that matters down. A crag's
    // panel names two points, the parking and the wall, then the road in three
    // fixed rows — see crag-points.ts and access-section.ts.
    furniture('foto',       'Foto', 'foto'),
    furniture('parcheggio', 'Come arrivare', 'punti'),
    furniture('servizi',    'Servizi'),
    furniture('webcam',     'Webcam'),
  ],
  parts: parts({
    label: { it: 'Vie' },
    each: { it: 'via' },
    ordered: false,
    groupBy: { it: 'Settore' },
    fields: [
      // Optional: plenty of crags have no names at the foot of their vie, and
      // their topos say so ("non ci sono i nomi alla base"). A via is still
      // there, still numbered and graded; its row shows a dash, never a made-up name.
      fact('nome',      text,                { label: { it: 'Nome' }, optional: true }),
      // Optional: a topo can list a variant without grading it. The crag's
      // gradi, its histogram and Find's grade bounds are read off the graded
      // vie only; a crag none of whose vie is graded still fails, because
      // gradi (above) is required.
      fact('grado',     gradeScale('sport'), { label: { it: 'Grado' }, optional: true }),
      // Optional: a via's length is what a guidebook knows and a twenty-year-old
      // web archive mostly does not. It is the via's own, never summed up into a
      // crag-wide figure in the header: a span across a whole wall says nothing.
      fact('lunghezza', metres,              { label: { it: 'Lunghezza' }, optional: true }),
    ],
  }),
  current: { days: 14 },
})
