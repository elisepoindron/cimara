import { shell, type Viewer } from './shell.ts'
import { html, join, type Html } from './html.ts'
import { brand } from './site.ts'
import type { ScaleInUse } from '../domain/grade-scales.ts'
import { groups, SCALE_GUIDES, SCALE_SLUG, type Axis, type ScaleGuide, type Subject } from './info-content.ts'

export interface InfoPageOpts {
  /** The archive's own scales, from `scalesInUse`: a guide names the activities graded on its scale. */
  readonly scales: readonly ScaleInUse[]
  readonly viewer?: Viewer | null
  readonly csrf?: string
}

/** Where a page sits in Info: the hub, a subject, or one scale's guide. */
export type InfoPath =
  | { readonly kind: 'hub' }
  | { readonly kind: 'subject'; readonly slug: string }
  | { readonly kind: 'scale'; readonly slug: string }

const href = (s: Subject) => `/info/${s.slug}`
const scaleHref = (g: ScaleGuide) => `/info/${SCALE_SLUG}/${g.slug}`

/**
 * The list at the side of every subject page: every group and subject, the
 * scales under theirs, the open one marked. A subject still to come is a name
 * with no link. On a phone the list is not drawn; the hub is the list there.
 */
function side(on: InfoPath): Html {
  const subject = (s: Subject): Html => {
    if (s.soon) return html`<span class="info__soon">${s.title}</span>`
    const cur = on.kind === 'subject' && on.slug === s.slug
    const link = html`<a href="${href(s)}"${cur ? html` aria-current="page"` : html``}>${s.title}</a>`
    if (s.slug !== SCALE_SLUG) return link
    return html`${link}<div class="info__sub">${join(SCALE_GUIDES.map(g => {
      const gcur = on.kind === 'scale' && on.slug === g.slug
      return html`<a href="${scaleHref(g)}"${gcur ? html` aria-current="page"` : html``}>${g.title}</a>`
    }), '')}</div>`
  }
  return html`<div class="info__side" role="navigation" aria-label="Info">${join(groups().map(g => html`<div>
      <span class="lab">${g.title}</span>${join(g.subjects.map(subject), '')}
    </div>`), '')}</div>`
}

/** A subject page: the side list, and the subject with its way back on a phone. */
function frame(title: string, on: InfoPath, crumb: Html, body: Html, opts: InfoPageOpts): string {
  return shell({
    title: `${title} · Info`,
    tab: 'info',
    viewer: opts.viewer,
    csrf: opts.csrf,
    body: html`<div class="wrap">
  <div class="info">
    ${side(on)}
    <div class="info__main">
      ${on.kind === 'scale'
        ? html`<a class="info__back" href="/info/${SCALE_SLUG}">‹ Scale di difficoltà</a>`
        : html`<a class="info__back" href="/info">‹ Info</a>`}
      <p class="info__crumb">${crumb}</p>
      <h1>${title}</h1>
      ${body}
    </div>
  </div>
</div>`,
  })
}

/**
 * One scale's levels, in words: the label, its name, its measure where it has
 * one, one line. A scale with several axes is a card per axis, each under its name.
 */
function axis(a: Axis): Html {
  return html`${a.name ? html`<h2 class="lab">${a.name}</h2>` : html``}<div class="info__levels">${join(a.levels.map(l => html`<div>
        <b>${l.label}</b><span>${l.name}${l.measure ? html`<em>${l.measure}</em>` : html``}<small>${l.line}</small></span>
      </div>`), '')}</div>`
}

function scaleGuide(g: ScaleGuide, opts: InfoPageOpts): string {
  const users = g.system ? opts.scales.find(s => s.system === g.system)?.activities ?? [] : []
  const crumb = html`<a href="/info">Info</a> · <a href="/info/${SCALE_SLUG}">Scale di difficoltà</a>`
  return frame(g.title, { kind: 'scale', slug: g.slug }, crumb, html`
      <p class="info__intro">${g.intro}</p>
      ${users.length ? html`<p class="info__users">Nell'archivio: ${users.join(', ')}</p>` : html``}
      ${join(g.axes.map(axis), '\n      ')}`, opts)
}

function rows(items: readonly { href: string | null; title: string; line?: string }[]): Html {
  return html`<div class="info__rows">${join(items.map(i => i.href
    ? html`<a href="${i.href}"><b>${i.title}</b>${i.line ? html`<small>${i.line}</small>` : html``}</a>`
    : html`<span class="info__soon"><b>${i.title}</b><small>presto</small></span>`), '')}</div>`
}

const crumbInfo = html`<a href="/info">Info</a>`

/** A brand's words: the first paragraph as the page's opening, the rest as it is. */
function prose(paragraphs: readonly string[]): Html {
  const [first, ...rest] = paragraphs
  return html`
      <p class="info__intro">${first ?? ''}</p>
      ${join(rest.map(p => html`<p>${p}</p>`), '\n      ')}`
}

/** The words of each plain subject. Short on purpose: Info says where things are, not everything about them. */
const SUBJECT_BODY: Record<string, (opts: InfoPageOpts) => Html> = {
  [SCALE_SLUG]: () => html`
      <p class="info__intro">Ogni attività ha la sua scala. Qui, livello per livello, cosa vuol dire.</p>
      ${rows(SCALE_GUIDES.map(g => ({ href: scaleHref(g), title: g.title, line: g.line })))}`,
  'chi-siamo': () => prose(brand().about.paragraphs),
  contatti: () => {
    const to = brand().contact ?? ''
    return html`
      <p class="info__intro">Per una scheda da correggere, usa <em>Proponi una modifica alla scheda</em> in fondo alla sua pagina: arriva alla redazione con il nome della scheda.</p>
      <p>Per tutto il resto, scrivi a <a href="mailto:${to}">${to}</a>.</p>`
  },
  privacy: () => prose(brand().privacy.paragraphs),
}

/**
 * The hub: every group of subjects as rows, the way into each. On a desktop
 * the subject pages carry the same list at their side; on a phone this page is
 * the list.
 */
function hub(opts: InfoPageOpts): string {
  return shell({
    title: 'Info',
    tab: 'info',
    viewer: opts.viewer,
    csrf: opts.csrf,
    body: html`<div class="wrap">
  <div class="phead"><h1>Info</h1></div>
  <div class="info__hub">
    <p class="info__intro">Tutto ciò che sta intorno all'archivio: come leggerlo, chi lo scrive, come scriverci.</p>
    ${join(groups().map(g => html`<section>
      <h2 class="lab">${g.title}</h2>
      ${rows(g.subjects.map(s => ({ href: s.soon ? null : href(s), title: s.title, line: s.line })))}
    </section>`), '\n    ')}
  </div>
</div>`,
  })
}

/** The page at an Info path, or null where nothing is: a subject still to come has no page. */
export function infoPage(path: InfoPath, opts: InfoPageOpts): string | null {
  if (path.kind === 'hub') return hub(opts)
  if (path.kind === 'scale') {
    const g = SCALE_GUIDES.find(x => x.slug === path.slug)
    return g ? scaleGuide(g, opts) : null
  }
  const subject = groups().flatMap(g => g.subjects).find(s => s.slug === path.slug && !s.soon)
  const body = subject ? SUBJECT_BODY[subject.slug] : undefined
  if (!subject || !body) return null
  return frame(subject.title, path, crumbInfo, body(opts), opts)
}
