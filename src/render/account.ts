import { asset } from './assets.ts'
import { html, type Html } from './html.ts'
import { problemsList } from './problems.ts'
import { brand } from './site.ts'
import { shell } from './shell.ts'


/**
 * Both pages, in the shared chrome, laid out the way a route page is: the
 * title on the paper, then one lifted card (`.l3`, the route page's own)
 * holding the form as the reading column and a short rail beside it. No viewer is passed because nobody
 * signing in or registering is signed in yet — the nav's way-in link is the
 * right one to show here.
 *
 * The whole page fits one screen on a laptop; the stylesheet keeps it compact
 * rather than clipping it, so a short window still scrolls instead of hiding
 * the button.
 */
function page(title: string, heading: string, form: Html, rail: Html): string {
  return shell({
    title,
    tab: 'accedi',
    extraHead: html`<script src="${asset('/password-peek.js')}" defer></script>`,
    body: html`<div class="wrap">
  <div class="phead">
    <h1>${title}</h1>
  </div>
  <main class="account l3 acc">
    <div class="acc__form">
      <h2>${heading}</h2>
      ${form}
    </div>
    <aside class="acc__rail">${rail}</aside>
  </main>
</div>`,
  })
}

/**
 * The password field, with room for the "Mostra" control password-peek.js
 * adds. Without the script it is a plain password field.
 */
function passwordField(id: string, autocomplete: string): Html {
  return html`<p>
      <label for="${id}">Password</label>
      <span class="pw"><input id="${id}" type="password" name="password" autocomplete="${autocomplete}" required></span>
    </p>`
}

/**
 * What an account is for, said once, on the sign-up page's rail. The way to
 * the other page sits under it on both pages, so the form column ends at its
 * button and the page still fits one screen when a failed attempt adds its
 * problems above the fields.
 */
const WHY = html`<h2>Con un account</h2>
  <dl class="acc__why">
    <div><dt>Racconti le tue gite</dt><dd>Ogni relazione entra nell'archivio e aggiorna <i>Dalle ultime gite</i> per chi ci va dopo di te.</dd></div>
    <div><dt>Salvi i preferiti</dt><dd>Gli itinerari che vuoi fare, in una lista sola.</dd></div>
    <div><dt>Puoi sempre ritirare</dt><dd>Una relazione si ritira in ogni momento, senza cancellare niente.</dd></div>
  </dl>`

export interface SignUpOpts {
  readonly csrf: string
  readonly problems?: readonly string[]
  readonly email?: string
  readonly displayName?: string
}

/**
 * The password never comes back in `opts` on a failed attempt — only the
 * caller decides that by omitting it — so there is nothing here to echo and
 * no `value` attribute on the field at all.
 *
 * The name comes first: it is what signs every relazione, so it is the field
 * the rest of the site will show.
 */
export function signUpPage(opts: SignUpOpts): string {
  return page('Registrati', 'Il tuo account', html`<form method="post" action="/registrati" novalidate>
    <input type="hidden" name="csrf" value="${opts.csrf}">
    ${problemsList(opts.problems)}
    <p>
      <label for="su-nome">Nome</label>
      <input id="su-nome" type="text" name="nome" value="${opts.displayName ?? ''}" autocomplete="nickname" required>
      <small>È il nome che firma le tue relazioni.</small>
    </p>
    <p>
      <label for="su-email">Email</label>
      <input id="su-email" type="email" name="email" value="${opts.email ?? ''}" autocomplete="email" required>
    </p>
    ${passwordField('su-password', 'new-password')}
    <button type="submit">Registrati</button>
  </form>`, html`${WHY}
  <div class="alt"><span>Hai già un account?</span><a class="btn" href="/accedi">Accedi</a></div>`)
}

export interface SignInOpts {
  readonly csrf: string
  readonly problems?: readonly string[]
  readonly email?: string
  readonly next?: string
}

export function signInPage(opts: SignInOpts): string {
  return page('Accedi', 'Entra nel tuo account', html`<form method="post" action="/accedi" novalidate>
    <input type="hidden" name="csrf" value="${opts.csrf}">
    ${opts.next ? html`<input type="hidden" name="next" value="${opts.next}">` : null}
    ${problemsList(opts.problems)}
    <p>
      <label for="si-email">Email</label>
      <input id="si-email" type="email" name="email" value="${opts.email ?? ''}" autocomplete="email" required>
    </p>
    ${passwordField('si-password', 'current-password')}
    <button type="submit">Accedi</button>
  </form>`, html`<h2>Nuovo su ${brand().name}?</h2>
  <p class="acc__note">Con un account racconti le tue gite e salvi gli itinerari che vuoi fare.</p>
  <div class="alt"><span>Non hai un account?</span><a class="btn" href="/registrati">Registrati</a></div>`)
}
