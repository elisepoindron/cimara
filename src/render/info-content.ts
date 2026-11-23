import type { GradeSystem } from '../domain/find/constraints.ts'
import { brand } from './site.ts'

/**
 * What Info holds, as data: the subjects in their groups, and one guide per
 * grade scale. Italian, because every word here is read by a climber.
 *
 * A subject marked `soon` is drawn in the list, unlinked, so the list says what
 * Info will hold; it has no page until it has words.
 */

export interface Subject {
  readonly slug: string
  readonly title: string
  /** One line under the title, in the hub's rows. */
  readonly line?: string
  readonly soon?: true
}

export interface SubjectGroup {
  readonly title: string
  readonly subjects: readonly Subject[]
}

export const SCALE_SLUG = 'scale'

/**
 * The groups, with the site's own subjects named and summed up by its brand
 * (`src/seed/sets/<set>/brand/brand.json`). `Contatti` is there only where the
 * brand has an address to write to.
 */
export function groups(): readonly SubjectGroup[] {
  const b = brand()
  return [
    { title: 'Guida', subjects: [
      { slug: SCALE_SLUG, title: 'Scale di difficoltà', line: 'Cosa vuol dire un grado, attività per attività.' },
      { slug: 'come-scrivere', title: 'Come scrivere una relazione', soon: true },
    ] },
    { title: b.group, subjects: [
      { slug: 'chi-siamo', title: 'Chi siamo', line: b.about.line },
      ...(b.contact ? [{ slug: 'contatti', title: 'Contatti', line: 'La redazione, per tutto ciò che non è una scheda.' }] : []),
      { slug: 'forum', title: 'Forum', soon: true },
    ] },
    { title: 'Note legali', subjects: [
      { slug: 'privacy', title: 'Privacy e cookie', line: b.privacy.line },
      { slug: 'licenze', title: 'Licenze', soon: true },
    ] },
  ]
}

/** One step of a scale, said in words; `measure` where the step has one (degrees, metres, its grades). */
export interface Level {
  readonly label: string
  readonly name: string
  readonly line: string
  readonly measure?: string
}

/** A scale is one axis or several read together, as sci ripido's I · 5.3 · E4. */
export interface Axis {
  readonly name?: string
  readonly levels: readonly Level[]
}

export interface ScaleGuide {
  readonly slug: string
  readonly title: string
  /** The registry's scale this guide explains, where the archive grades with one. */
  readonly system?: GradeSystem
  /** The scale's name, in the list of scales. */
  readonly line: string
  readonly intro: string
  readonly axes: readonly Axis[]
}

export const SCALE_GUIDES: readonly ScaleGuide[] = [
  {
    slug: 'alpinismo', title: 'Alpinismo', system: 'alpine', line: 'Difficoltà complessiva, da F a EX.',
    intro: 'La difficoltà complessiva di una salita, dalla più facile alla più estrema. Un − o un + sposta di mezzo passo: AD+ sta tra AD e D.',
    axes: [{ levels: [
      { label: 'F', name: 'Facile', line: 'Sentiero o roccia facile; le mani servono poco.' },
      { label: 'PD', name: 'Poco difficile', line: 'Qualche passo di arrampicata, ghiacciai semplici.' },
      { label: 'AD', name: 'Abbastanza difficile', line: 'Arrampicata continua, pendii ripidi; la corda si usa.' },
      { label: 'D', name: 'Difficile', line: 'Lunghi tratti impegnativi, poche vie di fuga.' },
      { label: 'TD', name: 'Molto difficile', line: 'Impegno costante, per alpinisti esperti.' },
      { label: 'ED', name: 'Estremamente difficile', line: 'Al limite, in ogni tratto.' },
      { label: 'EX', name: 'Eccezionale', line: 'Oltre ED.' },
    ] }],
  },
  {
    slug: 'falesia-multipitch', title: 'Falesia e multipitch', system: 'sport', line: 'Scala francese, dal 3 al 9a.',
    intro: 'La scala francese: il grado del passaggio più duro di un tiro. Dal 4a in su ogni grado ha anche il suo +, a metà strada verso il successivo.',
    axes: [{ levels: [
      { label: '3', name: 'Facilissimo', line: 'Si sale quasi camminando, con appigli ovunque.' },
      { label: '4', name: 'Facile', line: 'Appigli grandi e vicini; i primi tiri in corda.', measure: '4a · 4b · 4c' },
      { label: '5', name: 'Moderato', line: 'Servono i piedi e un po’ di tecnica.', measure: '5a · 5b · 5c' },
      { label: '6', name: 'Impegnativo', line: 'Appigli più piccoli, movimenti da imparare.', measure: '6a · 6b · 6c' },
      { label: '7', name: 'Difficile', line: 'Per chi arrampica con costanza.', measure: '7a · 7b · 7c' },
      { label: '8', name: 'Molto difficile', line: 'Pochi ci arrivano.', measure: '8a · 8b · 8c' },
      { label: '9', name: 'Estremo', line: 'Il limite di chi arrampica oggi.', measure: '9a' },
    ] }],
  },
  {
    slug: 'escursionismo', title: 'Escursionismo', line: 'Scala CAI: T, E, EE, EEA.',
    intro: 'La scala del CAI, dal sentiero più semplice a quello attrezzato.',
    axes: [{ levels: [
      { label: 'T', name: 'Turistico', line: 'Sentieri larghi ed evidenti, senza difficoltà.' },
      { label: 'E', name: 'Escursionistico', line: 'Sentieri anche ripidi o su terreno vario; serve passo sicuro.' },
      { label: 'EE', name: 'Per escursionisti esperti', line: 'Tratti esposti, ghiaioni, brevi passi su roccia.' },
      { label: 'EEA', name: 'Esperti con attrezzatura', line: 'Sentieri attrezzati e vie ferrate: imbrago e set da ferrata.' },
    ] }],
  },
  {
    slug: 'sci-alpinismo', title: 'Sci alpinismo', line: 'Scala Blachère: MS, BS, OS.',
    intro: 'La scala Blachère, che dice che sciatore serve. Una A finale (BSA) indica tratti alpinistici: ramponi, piccozza, a volte corda.',
    axes: [{ levels: [
      { label: 'MS', name: 'Medio sciatore', line: 'Pendii moderati, senza tratti delicati.' },
      { label: 'BS', name: 'Buon sciatore', line: 'Pendii più ripidi o stretti, neve variabile.' },
      { label: 'OS', name: 'Ottimo sciatore', line: 'Pendii ripidi ed esposti, passaggi obbligati.' },
    ] }],
  },
  {
    slug: 'sci-ripido', title: 'Sci ripido', line: 'Tre scale: ingaggio, difficoltà tecnica, esposizione.',
    intro: "Un grado si legge in tre parti, come IV 5.3 E4: l'impegno della linea, la difficoltà dello sci, cosa trova una caduta.",
    axes: [
      { name: 'Ingaggio', levels: [
        { label: 'I', name: 'Linea evidente', line: 'Facile da trovare, impegno basso.' },
        { label: 'II', name: 'Da conoscere', line: 'Serve un po’ di conoscenza del terreno.' },
        { label: 'III', name: 'Da studiare', line: 'Linea lunga o complessa; conviene studiarla prima.' },
        { label: 'IV', name: 'Molto impegnativa', line: 'Lunga, complessa, difficile da leggere.' },
      ] },
      { name: 'Difficoltà tecnica', levels: [
        { label: '1', name: 'Pendii aperti', line: 'Mai oltre 30°, meno di 800 m di discesa.', measure: '≤ 30°' },
        { label: '2', name: 'Senza passi tecnici', line: 'Niente arriva a 35°; dislivello ed esposizione possono contare.', measure: '< 35°' },
        { label: '3', name: 'Il primo sci alpinismo', line: 'Pendii fino a 35°, brevi tratti a 40–45°.', measure: '35° · tratti a 45°' },
        { label: '4', name: 'Il canale classico', line: 'Lunghi pendii a 40°, per almeno 300 m.', measure: '40° · 300 m' },
        { label: '5', name: 'Sci ripido', line: 'Da 45° in su, aperto in alto: 5.1, 5.2, 5.3…', measure: '≥ 45°' },
      ] },
      { name: 'Esposizione', levels: [
        { label: 'E1', name: 'Il pendio', line: 'Nessun ostacolo oltre il pendio stesso.' },
        { label: 'E2', name: 'Una barra', line: 'Un piccolo salto di roccia da superare o da colpire.' },
        { label: 'E3', name: 'Salti di roccia', line: 'Un impatto violento è probabile: non si cade.' },
        { label: 'E4', name: 'Salti alti', line: 'Un impatto violento è certo: non si cade.' },
      ] },
    ],
  },
]
