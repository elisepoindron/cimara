import { html, raw, render, type Html } from './html.ts'
import { asset, importMap } from './assets.ts'
import { site } from './site.ts'

/**
 * Who is reading. The nav needs the name; task 12's author-only control needs
 * the id, to ask whether the reader wrote the report on screen.
 */
export interface Viewer {
  readonly id: string
  readonly displayName: string
}

export interface ShellOpts {
  /** The page's own name. " — " and the site's name are added here, once, for every page. */
  readonly title: string
  readonly viewer?: Viewer | null
  /** Only a page that knows this can offer a way out: `/esci` is a POST. */
  readonly csrf?: string
  readonly body: Html
  /**
   * Extra `<link>`/`<script>` tags only some pages need — MapLibre's, so far.
   * `shell()` is shared by every page, so nothing here is paid for by a page
   * that does not set it.
   */
  readonly extraHead?: Html
  /**
   * Which of the four places this page belongs to, for the phone's tab bar.
   * Absent, none is marked: a page that is not under one of them says so.
   */
  readonly tab?: Tab
  /**
   * The page's own name, when it has one worth keeping in view: on a phone the
   * header takes it once the page's title has scrolled away (S2 and N1), with
   * the page's star beside it. Absent, the header always says the site's name.
   */
  readonly pageName?: string
}

/** The four places a visitor goes back to, the tab bar's and the header's. */
export type Tab = 'trova' | 'preferiti' | 'info' | 'accedi'


/**
 * Every page's chrome: the head, the mark and the nav. It was written twice —
 * privately in `account.ts` and inline in `itinerary-page.ts` — and the two
 * copies had already drifted, one linking `/accedi` and the other `#`.
 */
export function shell(opts: ShellOpts): string {
  const { brand, demo } = site()
  return render(html`<html lang="it">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>${opts.title} — ${brand.name}</title>
<link rel="icon" type="image/svg+xml" href="/assets/logo/mark.svg">
<link rel="icon" type="image/png" sizes="32x32" href="/assets/logo/mark-32.png">
<link rel="apple-touch-icon" href="/assets/logo/mark-180.png">
<script src="${asset('/page-motion.js')}" blocking="render"></script>
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Archivo:wght@400;500;600;700&family=Archivo+Narrow:wght@500;600;700&display=swap" rel="stylesheet">
<link rel="stylesheet" href="${asset('/app.css')}">
${brandName(brand.name)}
${importMap()}
<script type="module" src="${asset('/ground-motion.js')}"></script>
<script type="module" src="${asset('/grade-nine.js')}"></script>
${opts.extraHead}

<header${opts.pageName ? html` class="has-name"` : html``}>
  <div class="mark"><a href="/"><img src="/assets/logo/mark.svg" alt="" width="28" height="28"><span class="mark__w">${brand.name}</span></a></div>
  ${opts.pageName ? html`<div class="hname" aria-hidden="true"><span>${opts.pageName}</span></div>
  <button type="button" class="hstar" aria-hidden="true" tabindex="-1"><svg viewBox="0 0 24 24"><path d="M12 2 L15.09 8.26 L22 9.27 L17 14.14 L18.18 21 L12 17.77 L5.82 21 L7 14.14 L2 9.27 L8.91 8.26 Z"/></svg></button>
  <script src="${asset('/page-phone.js')}" defer></script>` : html``}
  <nav>
    <a href="/trova">Trova</a>
    <a href="/preferiti">Preferiti</a>
    <a href="/info">Info</a>
    ${who(opts.viewer ?? null, opts.csrf)}
  </nav>
</header>
${demo ? demoNote() : html``}
${opts.body}

${tabBar(opts.tab, opts.viewer ?? null, opts.csrf)}`)
}

/**
 * The name, as a CSS string for the home's opening, which app.css writes in
 * with `content:var(--brand)`. Its own element, as raw text: a name is ours
 * (brand.json), and JSON's quoting is CSS's for every character one holds;
 * `<` is refused so nothing can close the element early.
 */
function brandName(name: string): Html {
  if (/[<\\]/.test(name)) throw new Error(`brand: a name with < or \\ cannot be a CSS string: ${name}`)
  return raw(`<style>:root{--brand:${JSON.stringify(name)}}</style>`)
}

/**
 * On every page of the public demonstration, under the header: what is real
 * and what is not, and whose places these are. OpenStreetMap's licence asks
 * for the credit wherever its data is shown.
 */
function demoNote(): Html {
  return html`<p class="demo-note" lang="it">Dati inventati a scopo dimostrativo: i luoghi sono reali, le relazioni no. <span>Luoghi © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, licenza ODbL.</span></p>`
}

/* The bar's icons, drawn on a 24-unit grid with one stroke. */
const ICON: Record<Tab, Html> = {
  trova: html`<circle cx="11" cy="11" r="6.5"/><path d="M16 16l4.5 4.5"/>`,
  preferiti: html`<path d="M12 3.8l2.5 5.2 5.6.7-4.1 3.9 1 5.6L12 16.5l-5 2.7 1-5.6-4.1-3.9 5.6-.7z"/>`,
  info: html`<circle cx="12" cy="12" r="8.5"/><path d="M12 11v5.5M12 7.6v.1"/>`,
  accedi: html`<circle cx="12" cy="8.5" r="3.8"/><path d="M4.5 20c1.2-3.8 4-5.5 7.5-5.5s6.3 1.7 7.5 5.5"/>`,
}
const icon = (t: Tab) => html`<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[t]}</svg>`

/**
 * On a phone the header's four words move to the bottom of the screen, under
 * the thumb, as a bar of four places (a design study, A2
 * and T1). Above 760px it is not shown and the header keeps them. A div, not
 * a second nav, so the header nav's small capitals never reach it.
 *
 * Signed in, the fourth place is the reader: their name, opening the way out
 * in place, since there is no page of one's own to go to yet.
 */
function tabBar(active: Tab | undefined, viewer: Viewer | null, csrf: string | undefined): Html {
  const place = (t: Tab, href: string, label: string) =>
    html`<a href="${href}"${active === t ? html` aria-current="page"` : html``}>${icon(t)}<span>${label}</span></a>`
  const me = !viewer
    ? place('accedi', '/accedi', 'Accedi')
    : html`<details class="tabbar__me"><summary>${icon('accedi')}<span>${viewer.displayName}</span></summary>
      ${csrf
        ? html`<form class="tabbar__out" method="post" action="/esci"><input type="hidden" name="csrf" value="${csrf}"><button type="submit">Esci</button></form>`
        : html``}</details>`
  return html`<div class="tabbar" role="navigation" aria-label="Sezioni">
  ${place('trova', '/trova', 'Trova')}
  ${place('preferiti', '/preferiti', 'Preferiti')}
  ${place('info', '/info', 'Info')}
  ${me}
</div>`
}

/**
 * Signed out, the way in. Signed in, the name and the way out — as a form,
 * because `/esci` is a POST and a link that ended a session could be fired by
 * any page that embedded it as an image.
 *
 * Both are optional: plenty of callers know neither, and a page that does not
 * know who is reading renders the signed-out nav rather than failing. A caller
 * that knows the viewer but has no token shows the name alone, since a form it
 * cannot sign would only be refused.
 */
function who(viewer: Viewer | null, csrf: string | undefined): Html {
  if (!viewer) return html`<a href="/accedi">Accedi</a>`
  if (!csrf) return html`<span class="who">${viewer.displayName}</span>`

  return html`<span class="who">${viewer.displayName}</span>
    <form class="out" method="post" action="/esci">
      <input type="hidden" name="csrf" value="${csrf}">
      <button type="submit">Esci</button>
    </form>`
}
