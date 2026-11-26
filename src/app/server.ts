import http from 'node:http'
import { creditsOf } from '../db/credits.ts'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { fileURLToPath } from 'node:url'
import { dirname, extname, join, normalize } from 'node:path'
import type { Db } from '../db/open.ts'
import { byId, nearbyRoutes, partsOf } from '../db/itinerary.ts'
import { findGita, giteFor } from '../db/gita.ts'
import { photosFor, standingPhoto } from '../db/gita-photo.ts'
import { ancestorsOf } from '../db/place.ts'
import { isFavorite } from '../db/favorite.ts'
import { activityOf } from '../domain/activities/index.ts'
import { resolveFacts, resolveAccessFacts } from '../domain/facts.ts'
import { itineraryPage } from '../render/itinerary-page.ts'
import { versionAssets } from '../render/assets.ts'
import { photosPage } from '../render/photos-page.ts'
import { gitaPage } from '../render/gita-page.ts'
import { giteListPage } from '../render/gite-list-page.ts'
import { findPage } from '../render/find-page.ts'
import { homePage } from '../render/home-page.ts'
import { homeRoutes } from './home.ts'
import { signUpPage, signInPage, visitorSignInPage } from '../render/account.ts'
import { html, render } from '../render/html.ts'
import { ALT_TOLERANCE_M, MAP_NEIGHBOUR_RADIUS_M, NEIGHBOUR_RADIUS_M } from './conditions.ts'
import { fileFromForm, retract, dayOf, sweepExpiredPendingPhotos, uploadPendingPhotos } from './gite.ts'
import { photoPickPage } from '../render/photo-pick.ts'
import { livePendingPhotos } from '../db/pending-photo.ts'
import { addFavorite, removeFavorite, listFavorites } from './favorites.ts'
import { favoritesPage } from '../render/favorites-page.ts'
import { infoPage, type InfoPath } from '../render/info-page.ts'
import { SCALE_SLUG } from '../render/info-content.ts'
import { scalesInUse } from '../domain/grade-scales.ts'
import { answersAsTyped, crumbLines, find, type RewriteLine } from './find.ts'
import { LINE_EXAMPLES, SHOWN_EXAMPLES } from '../render/line-examples.ts'
import { activityCounts, searchItineraries, type Box } from '../db/search.ts'
import { ACTIVITIES } from '../domain/activities/index.ts'
import {
  readFormBody, parseCookies, cookie, setCookie, clearCookie, csrfTokenFor, csrfOk,
  BodyTooLarge, SESSION_COOKIE, secureCookies, readMultipartBody, MAX_PHOTO_BODY_BYTES,
  type UploadedFile,
} from './http.ts'
import { signUp, signIn, signOut, accountForSession, visitorSignIn, SESSION_DAYS } from './accounts.ts'
import { budget, type Budget, type Limits } from './model-budget.ts'
import type { AccountRow } from '../db/account.ts'
import type { PhotoStore } from './photo-store.ts'
import { filesystemPhotoStore, mimeForExt } from './photo-store.ts'
import type { CallModel } from './synthesis.ts'
import { updateSynthesis, backfillSyntheses } from './synthesis.ts'
import { FIRST_FETCH_WAIT_MS, weatherFor, type FetchWeather } from './weather.ts'
import { weatherSpot } from '../domain/weather.ts'
import { STATION_RADIUS_M, STATIONS_SHOWN } from '../domain/stations.ts'
import { stationsNear } from '../db/weather-station.ts'
import { trailFor, type FetchTrail } from './trail.ts'
import { accessPoints } from '../domain/geo.ts'
import { trackFor } from '../db/track.ts'
import { profileFor, type FetchTile } from './terrain.ts'
import { fetchTerrainTile } from './terrain-client.ts'
import { synthesisFor } from '../db/synthesis.ts'
import { accessTokenOf, type AccessGate } from './access.ts'
import { brand, configureSite, site } from '../render/site.ts'
import { demoBusyPage } from '../render/demo-pages.ts'

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..')
const TYPES: Record<string, string> = {
  '.css': 'text/css', '.js': 'text/javascript', '.mjs': 'text/javascript',
  '.jpg': 'image/jpeg', '.png': 'image/png', '.svg': 'image/svg+xml', '.json': 'application/json',
}

/**
 * Every static client script this app serves from `public/`, by exact path.
 * A named allowlist rather than a generic "serve any .js under public/" rule
 * — one place states exactly what is servable, the same reason `db/migrate.ts`
 * is the one place that executes opaque files it never inspects.
 */
const PUBLIC_SCRIPTS = ['/home-map.js', '/find-map.js', '/list-in-view.js', '/find-live.js', '/find-menus.js', '/page-motion.js', '/ground-motion.js', '/parking-map.js', '/crag-map.js', '/map-core.js', '/gallery-lightbox.js', '/photo-zoom.js', '/password-peek.js', '/line-examples.js', '/vie-fold.js', '/station-fold.js', '/words-count.js', '/grade-nine.js', '/page-phone.js', '/find-sheet.js', '/profile.js']

/**
 * Every stylesheet and script the pages load, with a hash of its bytes, read
 * once at startup. The pages ask for `path?v=<hash>` (src/render/assets.ts),
 * and that address is answered as `immutable`: a phone keeps the file and
 * never asks for it again until a deploy changes it, and with it the address.
 * MapLibre's worker is left out: the library builds its address itself.
 */
const VERSIONS: ReadonlyMap<string, string> = new Map(
  ['/app.css', ...PUBLIC_SCRIPTS, '/vendor/maplibre-gl.mjs', '/vendor/maplibre-gl-shared.mjs', '/vendor/maplibre-gl.css']
    .map(path => [path, createHash('sha1').update(readFileSync(join(ROOT, 'public', path.slice(1)))).digest('base64url').slice(0, 10)]),
)

// Secure over plain HTTP makes the cookie silently vanish — see setCookie in
// http.ts — so this only turns on where the deploy is known to be HTTPS.
const SECURE_COOKIES = secureCookies()

export function createServer(
  db: Db, photos: PhotoStore, pendingPhotos: PhotoStore, callModel: CallModel | null,
  fetchWeather: FetchWeather | null, rewriteLine: RewriteLine | null = null,
  fetchTrail: FetchTrail | null = null, access: AccessGate | null = null,
  options: ServerOptions = {},
): http.Server {
  // Read once: these files only change with a deploy, which restarts this.
  versionAssets(VERSIONS)
  // Every page this server draws says whether it is the demonstration.
  configureSite({ demo: options.publicDemo === true })
  const demo: DemoState | null = options.publicDemo === true
    ? { reports: budget(options.demoLimits?.reports ?? DEMO_REPORTS), photos: budget(options.demoLimits?.photos ?? DEMO_PHOTOS) }
    : null
  return http.createServer(async (req, res) => {
    try {
      // Before anything else, static files included: a deploy behind
      // Cloudflare Access answers nobody Access did not let through.
      if (access && !(await access(accessTokenOf(req.headers, parseCookies(req.headers.cookie))))) {
        return send(res, 403, HTML, render(html`<html lang="it"><title>Accesso riservato</title>
          <p>Questa versione di ${brand().name} è riservata a chi è stato invitato.</p>`))
      }
      await route(db, photos, pendingPhotos, callModel, fetchWeather, rewriteLine, fetchTrail, options.fetchTile ?? null, req, res, demo)
    } catch (err) {
      console.error(err)
      // A throw after headers are already on the wire (a partial send, then an
      // error) must not attempt a second writeHead — that throws inside this
      // catch, uncaught, and takes the process down.
      if (!res.headersSent) send(res, 500, 'text/plain; charset=utf-8', 'Errore interno')
    }
  })
}

export interface ServerOptions {
  /**
   * The public demonstration (`PUBLIC_DEMO=1`): every page says what is
   * invented; nobody signs up, every visitor enters one shared account
   * (`visitorSignIn`), and what they write is kept only until a restart.
   */
  readonly publicDemo?: boolean
  /** The demonstration's ceilings on reports filed and photos sent; tests set their own. */
  readonly demoLimits?: { readonly reports?: Limits; readonly photos?: Limits }
  /** Reads the terrain under a route's track, for its elevation profile. Absent: no profile is read. */
  readonly fetchTile?: FetchTile | null
}

/**
 * Paid model calls on the demonstration, Find's and the report reading's
 * together: a reading can take three (read, merge, check), a rewrite one.
 */
const DEMO_MODEL_CALLS: Limits = { perMinute: 6, perHour: 40, perDay: 150 }

/** What strangers may write on the demonstration before it asks them to come back later. */
const DEMO_REPORTS: Limits = { perMinute: 5, perHour: 30, perDay: 150 }
/** Each upload carries up to six photos of up to 8 MB, on the container's own disk. */
const DEMO_PHOTOS: Limits = { perMinute: 3, perHour: 15, perDay: 60 }

interface DemoState {
  readonly reports: Budget
  readonly photos: Budget
}

/** Who — if anyone — a request's session cookie authenticates, plus the pieces
 * every account-route handler needs: the database, the photo store, the
 * pending-photo store, the model caller (`null` where none is configured),
 * the raw request/response, the parsed URL, and this request's CSRF token. */
interface Ctx {
  readonly db: Db
  readonly photos: PhotoStore
  readonly pendingPhotos: PhotoStore
  readonly callModel: CallModel | null
  readonly fetchWeather: FetchWeather | null
  /** Rewrites a search line the parser could not read. Null without a key. */
  readonly rewriteLine: RewriteLine | null
  /** Asks a hiking router for a crag's walk in. Null where none is configured. */
  readonly fetchTrail: FetchTrail | null
  /** Reads terrain tiles for a route's profile. Null where none is configured. */
  readonly fetchTile: FetchTile | null
  readonly req: http.IncomingMessage
  readonly res: http.ServerResponse
  readonly url: URL
  readonly account: AccountRow | null
  readonly csrf: string
}

type Handler = (ctx: Ctx) => Promise<void>
interface RouteDef { readonly GET?: Handler; readonly POST?: Handler }

/** Every path answered by name rather than by pattern, and the methods it takes. */
const ROUTES: Record<string, RouteDef> = {
  '/registrati': { GET: getSignUp, POST: postSignUp },
  '/accedi': { GET: getSignIn, POST: postSignIn },
  '/esci': { POST: postSignOut },
  '/gita/nuova': { GET: getNewGita },
  '/gita': { POST: postGita },
  '/gita/foto': { POST: postGitaFoto },
  '/trova': { GET: getFind },
  '/preferiti': { GET: getFavorites },
  '/info': { GET: ctx => getInfo(ctx) },
}

async function route(
  db: Db, photos: PhotoStore, pendingPhotos: PhotoStore, callModel: CallModel | null,
  fetchWeather: FetchWeather | null, rewriteLine: RewriteLine | null, fetchTrail: FetchTrail | null,
  fetchTile: FetchTile | null, req: http.IncomingMessage, res: http.ServerResponse, demo: DemoState | null = null,
) {
  const url = new URL(req.url ?? '/', 'http://localhost')
  const path = url.pathname
  const method = req.method ?? 'GET'

  // Every request resolves who is signed in and mints a CSRF token before
  // dispatch, so any handler — the itinerary page included, which reads both —
  // can ask either question. csrfTokenFor works before anyone has signed in, which the
  // sign-in form itself needs.
  const cookies = parseCookies(req.headers.cookie)
  const account = await accountForSession(db, cookie(cookies, SESSION_COOKIE), new Date())
  const { token: csrf, setCookie: csrfSetCookie } = csrfTokenFor(req)
  if (csrfSetCookie) res.setHeader('Set-Cookie', csrfSetCookie)

  const ctx: Ctx = { db, photos, pendingPhotos, callModel, fetchWeather, rewriteLine, fetchTrail, fetchTile, req, res, url, account, csrf }

  if (demo) {
    // Nobody signs up on the demonstration: there is one account, entered here.
    if (path === '/registrati') return redirect(res, 303, '/accedi')
    if (path === '/accedi') {
      if (method === 'GET') return getVisitorSignIn(ctx)
      if (method === 'POST') return postVisitorSignIn(ctx)
    }
    if (method === 'POST' && path === '/gita' && !demo.reports.take()) return send(res, 429, HTML, demoBusyPage())
    if (method === 'POST' && path === '/gita/foto' && !demo.photos.take()) return send(res, 429, HTML, demoBusyPage())
  }

  const known = ROUTES[path]
  if (known) {
    const handler = known[method as 'GET' | 'POST']
    // A path this table knows, asked in a method it does not take: the
    // difference between "there is nothing here" and "not like that".
    if (!handler) return methodNotAllowed(res, Object.keys(known))
    return handler(ctx)
  }

  if (path === '/') return getHome(ctx)

  const ritira = /^\/gita\/([\w-]+)\/ritira$/.exec(path)
  if (ritira) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST'])
    return postRetract(ctx, ritira[1]!)
  }

  const info = /^\/info\/([\w-]+)(?:\/([\w-]+))?$/.exec(path)
  if (info) {
    if (method !== 'GET') return methodNotAllowed(res, ['GET'])
    const [, first, second] = info
    if (second === undefined) return getInfo(ctx, { kind: 'subject', slug: first! })
    return first === SCALE_SLUG ? getInfo(ctx, { kind: 'scale', slug: second }) : notFound(res)
  }

  const favAdd = /^\/preferiti\/([\w-]+)$/.exec(path)
  if (favAdd) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST'])
    return postFavoriteAdd(ctx, favAdd[1]!)
  }

  const favRemove = /^\/preferiti\/([\w-]+)\/rimuovi$/.exec(path)
  if (favRemove) {
    if (method !== 'POST') return methodNotAllowed(res, ['POST'])
    return postFavoriteRemove(ctx, favRemove[1]!)
  }

  const match = /^\/itinerario\/([\w-]+)$/.exec(path)
  if (match) {
    const page = await itineraryFor(ctx, match[1]!)
    return page ? send(res, 200, HTML, page) : notFound(res)
  }

  const relazioni = /^\/itinerario\/([\w-]+)\/relazioni$/.exec(path)
  if (relazioni) {
    const page = await relazioniFor(ctx, relazioni[1]!)
    return page ? send(res, 200, HTML, page) : notFound(res)
  }

  const fotoGallery = /^\/itinerario\/([\w-]+)\/foto$/.exec(path)
  if (fotoGallery) {
    const page = await photosPageFor(ctx, fotoGallery[1]!)
    return page ? send(res, 200, HTML, page) : notFound(res)
  }

  const pendingFoto = /^\/foto\/pending\/([\w-]+)\.(jpg|png)$/.exec(path)
  if (pendingFoto) return getPendingFoto(ctx, pendingFoto[1]!, pendingFoto[2] as 'jpg' | 'png')

  const foto = /^\/foto\/([\w-]+)\.(jpg|png)$/.exec(path)
  if (foto) return getFoto(ctx, foto[1]!, foto[2] as 'jpg' | 'png')

  // Safari, and any browser on a page that does not say, asks the root for a
  // favicon whatever the head declares; it gets the PNG the head offers.
  if (path === '/favicon.ico') return serveFile(req, res, '/assets/logo/mark-32.png')

  // The demonstration serves from public/assets/ only what its pages ask for
  // by a neutral name: anything else a deploy puts there is never the
  // public's to see.
  if (site().demo && path.startsWith('/assets/') && !aliased(path)) return notFound(res)

  if (path === '/app.css' || PUBLIC_SCRIPTS.includes(path) || path.startsWith('/assets/') ||
      path.startsWith('/vendor/'))
    return serveFile(req, res, path, url.searchParams.get('v'))

  return notFound(res)
}

type BodyResult =
  | { readonly ok: true; readonly fields: Map<string, string> }
  | { readonly ok: false; readonly status: number }

/**
 * A body over the cap is `BodyTooLarge` — its own status, 413. Anything else
 * a stream can throw (a client disconnecting mid-body, a malformed chunk) is
 * just a bad request, 400 — and either way this is caught here once, so no
 * handler risks an uncaught rejection taking the process down.
 */
async function parseBody(req: http.IncomingMessage): Promise<BodyResult> {
  try {
    return { ok: true, fields: await readFormBody(req) }
  } catch (err) {
    return { ok: false, status: err instanceof BodyTooLarge ? 413 : 400 }
  }
}

type FotoBodyResult =
  | { readonly ok: true; readonly fields: Map<string, string>; readonly files: readonly UploadedFile[] }
  | { readonly ok: false; readonly status: number }

/** `POST /gita/foto` is always multipart — it exists to receive files, and a
 * plain urlencoded post here has nothing this route wants. */
async function parseFotoBody(req: http.IncomingMessage, maxBytes: number): Promise<FotoBodyResult> {
  const contentType = req.headers['content-type'] ?? ''
  if (!contentType.startsWith('multipart/form-data')) return { ok: false, status: 400 }
  try {
    const { fields, files } = await readMultipartBody(req, contentType, maxBytes)
    return { ok: true, fields, files }
  } catch (err) {
    return { ok: false, status: err instanceof BodyTooLarge ? 413 : 400 }
  }
}

function sessionCookieHeader(sessionId: string): string {
  return setCookie(SESSION_COOKIE, sessionId, {
    maxAgeSeconds: 60 * 60 * 24 * SESSION_DAYS, secure: SECURE_COOKIES,
  })
}

/**
 * Where to go after signing in. Resolved against our own origin and accepted
 * only if it stays there — an allowlist, because a denylist of forbidden
 * characters has already missed "//", "\" and a literal tab in turn: the
 * WHATWG URL algorithm strips tab, CR and LF before parsing, so checking the
 * raw string answers a different question from the one that decides where a
 * browser actually goes. A substring check cannot be completed by
 * inspection; resolving and comparing origins can.
 *
 * Returns the reconstructed path, never the caller's string, so nothing
 * unparsed — a raw control character is illegal in a header value — ever
 * reaches `redirect()`'s `Location` header.
 */
function safeNext(value: string | undefined | null): string {
  if (!value) return '/'
  const base = 'http://app.invalid'   // never shown; exists only to resolve a relative path against
  try {
    const url = new URL(value, base)
    if (url.origin !== base) return '/'
    return url.pathname + url.search + url.hash
  } catch {
    return '/'
  }
}

async function getSignUp(ctx: Ctx) {
  send(ctx.res, 200, HTML, signUpPage({ csrf: ctx.csrf }))
}

async function postSignUp(ctx: Ctx) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)

  const email = parsed.fields.get('email') ?? ''
  const displayName = parsed.fields.get('nome') ?? ''
  const password = parsed.fields.get('password') ?? ''

  const result = await signUp(ctx.db, { email, password, displayName }, new Date())
  if (!result.ok) {
    // The address and the name come back; the password never does — losing
    // what someone typed is how you lose the person.
    return send(ctx.res, 200, HTML,
      signUpPage({ csrf: ctx.csrf, problems: result.problems, email, displayName }))
  }

  ctx.res.appendHeader('Set-Cookie', sessionCookieHeader(result.session.id))
  redirect(ctx.res, 303, '/')
}

async function getSignIn(ctx: Ctx) {
  const next = safeNext(ctx.url.searchParams.get('next'))
  send(ctx.res, 200, HTML, signInPage({ csrf: ctx.csrf, next: next === '/' ? undefined : next }))
}

async function postSignIn(ctx: Ctx) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)

  const email = parsed.fields.get('email') ?? ''
  const password = parsed.fields.get('password') ?? ''
  const rawNext = parsed.fields.get('next')
  const next = safeNext(rawNext)

  const result = await signIn(ctx.db, { email, password }, new Date())
  if (!result.ok) {
    return send(ctx.res, 200, HTML, signInPage({
      csrf: ctx.csrf, problems: result.problems, email,
      next: rawNext ? next : undefined,
    }))
  }

  ctx.res.appendHeader('Set-Cookie', sessionCookieHeader(result.session.id))
  redirect(ctx.res, 303, next)
}

async function getVisitorSignIn(ctx: Ctx) {
  const next = safeNext(ctx.url.searchParams.get('next'))
  send(ctx.res, 200, HTML, visitorSignInPage({ csrf: ctx.csrf, next: next === '/' ? undefined : next }))
}

async function postVisitorSignIn(ctx: Ctx) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)
  const { session } = await visitorSignIn(ctx.db, new Date())
  ctx.res.appendHeader('Set-Cookie', sessionCookieHeader(session.id))
  redirect(ctx.res, 303, safeNext(parsed.fields.get('next')))
}

async function postSignOut(ctx: Ctx) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)

  const sessionId = cookie(parseCookies(ctx.req.headers.cookie), SESSION_COOKIE)
  if (sessionId) await signOut(ctx.db, sessionId)

  for (const header of clearCookie(SESSION_COOKIE)) {
    ctx.res.appendHeader('Set-Cookie', header)
  }
  redirect(ctx.res, 303, '/')
}

/**
 * Signed out, a detour rather than a refusal: sign in and come straight back
 * to the form you were reaching for. No `foto` key at all is screen 1, the
 * picker; `foto` present — even as `foto=`, empty — is screen 2, resolving
 * whichever pending photos it names against this account's own live ones.
 */
async function getNewGita(ctx: Ctx) {
  if (!ctx.account) {
    const back = ctx.url.pathname + ctx.url.search
    return redirect(ctx.res, 303, `/accedi?next=${encodeURIComponent(back)}`)
  }

  const it = await byId(ctx.db, ctx.url.searchParams.get('itinerario') ?? '')
  if (!it) return notFound(ctx.res)

  if (!ctx.url.searchParams.has('foto')) {
    return send(ctx.res, 200, HTML, photoPickPage({
      itineraryId: it.id, itineraryName: it.name, csrf: ctx.csrf, viewer: ctx.account,
    }))
  }

  const ids = (ctx.url.searchParams.get('foto') ?? '').split(',').map(s => s.trim()).filter(s => s !== '')
  const photos = await livePendingPhotos(ctx.db, ctx.account.id, ids, new Date().toISOString())

  send(ctx.res, 200, HTML, gitaPage({
    schema: activityOf(it.activity), itineraryId: it.id, itineraryName: it.name,
    csrf: ctx.csrf, today: dayOf(new Date()), viewer: ctx.account, photos,
  }))
}

/**
 * Publishing. Signed out is 403 and not a redirect: a body has already been
 * sent, and there is nowhere to send it back to that would not lose it. This
 * request carries no file input any more — every photo it might promote
 * already exists as a `pending_photo` row, named by `foto_ids` — so it is
 * ordinary urlencoded, capped at the same `MAX_BODY_BYTES` every other
 * text-only form already uses.
 *
 * A refused submission comes back as the same form, holding everything that
 * was typed and every pending photo it still can show — `parsed.fields` is
 * exactly what arrived, and `livePendingPhotos` re-resolves `foto_ids`
 * against whatever of that batch has not since expired.
 */
async function postGita(ctx: Ctx) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)
  if (!ctx.account) return errorPage(ctx.res, 403)

  const it = await byId(ctx.db, parsed.fields.get('itinerario') ?? '')
  if (!it) return notFound(ctx.res)

  const result = await fileFromForm(ctx.db, ctx.photos, ctx.pendingPhotos,
    { itineraryId: it.id, accountId: ctx.account.id, fields: parsed.fields }, new Date())

  if (!result.ok) {
    const ids = (parsed.fields.get('foto_ids') ?? '').split(',').map(s => s.trim()).filter(s => s !== '')
    const photos = await livePendingPhotos(ctx.db, ctx.account.id, ids, new Date().toISOString())
    return send(ctx.res, 200, HTML, gitaPage({
      schema: activityOf(it.activity), itineraryId: it.id, itineraryName: it.name,
      csrf: ctx.csrf, today: dayOf(new Date()), viewer: ctx.account,
      values: parsed.fields, problems: result.problems, photos,
    }))
  }

  updateSynthesis(ctx.db, it.id, it.name, ctx.callModel, new Date())
    .catch(err => console.error('synthesis regeneration failed:', err))

  redirect(ctx.res, 303, `/itinerario/${it.id}`)
}

/**
 * Screen 1's own upload. Signed-in only, checked before any file is even
 * read — an anonymous upload endpoint is exactly the unauthenticated-
 * resource-consumption shape the shipped feature's own review already found
 * and closed once, on `/gita` itself.
 */
async function postGitaFoto(ctx: Ctx) {
  if (!ctx.account) return errorPage(ctx.res, 403)

  const parsed = await parseFotoBody(ctx.req, MAX_PHOTO_BODY_BYTES)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)

  const it = await byId(ctx.db, parsed.fields.get('itinerario') ?? '')
  if (!it) return notFound(ctx.res)

  await sweepExpiredPendingPhotos(ctx.db, ctx.pendingPhotos, ctx.account.id, new Date())

  const result = await uploadPendingPhotos(ctx.db, ctx.pendingPhotos, ctx.account.id, parsed.files, new Date())

  if (!result.ok) {
    return send(ctx.res, 200, HTML, photoPickPage({
      itineraryId: it.id, itineraryName: it.name, csrf: ctx.csrf, viewer: ctx.account,
      problems: result.problems,
    }))
  }

  redirect(ctx.res, 303, `/gita/nuova?itinerario=${it.id}&foto=${result.ids.join(',')}`)
}

async function getPendingFoto(ctx: Ctx, id: string, ext: 'jpg' | 'png') {
  if (!ctx.account) return notFound(ctx.res)
  const mime = mimeForExt(ext)
  const live = await livePendingPhotos(ctx.db, ctx.account.id, [id], new Date().toISOString())
  if (live.length === 0) return notFound(ctx.res)
  const bytes = await ctx.pendingPhotos.get(id, mime)
  if (!bytes) return notFound(ctx.res)
  send(ctx.res, 200, mime, bytes)
}

/**
 * Withdrawing. The author check happens in `retract`, not here — this handler
 * only turns its refusal into a status. A stranger and a signed-out visitor
 * both get 403 rather than 404: which reports exist is not a secret, and who
 * wrote them is already on the page.
 */
async function postRetract(ctx: Ctx, gitaId: string) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)
  if (!ctx.account) return errorPage(ctx.res, 403)

  // Read before withdrawing, for somewhere to send them afterwards: the gita
  // knows its route, and after this the conditions module will have changed.
  const gita = await findGita(ctx.db, gitaId)
  if (!gita) return notFound(ctx.res)

  const result = await retract(ctx.db, gitaId, ctx.account.id, new Date())
  if (!result.ok) return errorPage(ctx.res, 403)

  const it = await byId(ctx.db, gita.itineraryId)
  if (it) {
    updateSynthesis(ctx.db, it.id, it.name, ctx.callModel, new Date())
      .catch(err => console.error('synthesis regeneration failed:', err))
  }

  redirect(ctx.res, 303, `/itinerario/${gita.itineraryId}`)
}

/**
 * Favoriting. Signed out is 403, not a redirect, for the same reason
 * postGita/postRetract are: a body has already arrived.
 */
async function postFavoriteAdd(ctx: Ctx, itineraryId: string) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)
  if (!ctx.account) return errorPage(ctx.res, 403)

  const it = await byId(ctx.db, itineraryId)
  if (!it) return notFound(ctx.res)

  await addFavorite(ctx.db, ctx.account.id, it.id, new Date())
  redirect(ctx.res, 303, safeNext(parsed.fields.get('next')))
}

async function postFavoriteRemove(ctx: Ctx, itineraryId: string) {
  const parsed = await parseBody(ctx.req)
  if (!parsed.ok) return errorPage(ctx.res, parsed.status)
  if (!csrfOk(ctx.req, parsed.fields)) return errorPage(ctx.res, 403)
  if (!ctx.account) return errorPage(ctx.res, 403)

  const it = await byId(ctx.db, itineraryId)
  if (!it) return notFound(ctx.res)

  await removeFavorite(ctx.db, ctx.account.id, it.id)
  redirect(ctx.res, 303, safeNext(parsed.fields.get('next')))
}

/**
 * Find. A GET, so a search is a link somebody can send, and the whole screen
 * works with no JavaScript.
 *
 * The query is capped before it reaches the parser. A line nobody could have
 * typed is not a query, and the cost of finding that out should not scale with
 * what was sent.
 */
const QUERY_MAX = 200

async function getFind(ctx: Ctx) {
  const params = ctx.url.searchParams
  // The sentence's slots post their pieces as `p`, each as it would be typed;
  // joined, they are a line like any other. Sent on to `?q=` so the address
  // bar, the back button and a shared link all hold one readable line.
  if (!params.has('q') && params.has('p')) {
    const line = params.getAll('p').map(p => p.trim()).filter(p => p !== '').join(' ').slice(0, QUERY_MAX)
    return redirect(ctx.res, 302, line === '' ? '/' : `/trova?q=${encodeURIComponent(line)}`)
  }

  const query = (params.get('q') ?? '').slice(0, QUERY_MAX)
  // With nothing asked, Find has nothing to be: home is where an empty line lives.
  if (query.trim() === '') return redirect(ctx.res, 302, '/')

  // Where on the map and which page: both optional, both ignored when unreadable.
  const view = viewOf(params.get('vista'))
  const page = Number.parseInt(params.get('pagina') ?? '1', 10)
  const result = await find(ctx.db, query, new Date(), ctx.account?.id, ctx.fetchWeather, ctx.rewriteLine, {
    view, page: Number.isFinite(page) ? page : 1,
  })

  send(ctx.res, 200, HTML, findPage({
    query, constraints: result.constraints, rows: result.rows, total: result.total, reading: result.reading,
    totalAll: result.totalAll, page: result.page, pages: result.pages, points: result.points,
    view: view ? params.get('vista') : null,
    free: params.get('scrivi') === '1',
    examples: params.get('scrivi') === '1' ? await exampleLines(ctx.db, await activityCounts(ctx.db)) : undefined,
    viewer: ctx.account, csrf: ctx.csrf,
  }))
}

/**
 * `vista=w,s,e,n`, the map's view in degrees, as a box — or null when it is
 * missing, malformed, or not a box on this planet, in which case Find answers
 * for the whole map rather than refuse.
 */
export function viewOf(raw: string | null): Box | null {
  if (raw === null) return null
  const parts = raw.split(',')
  if (parts.length !== 4) return null
  const [w, s, e, n] = parts.map(Number) as [number, number, number, number]
  if (![w, s, e, n].every(Number.isFinite)) return null
  if (w >= e || s >= n || s < -90 || n > 90 || w < -180 || e > 180) return null
  return { minLon: w, minLat: s, maxLon: e, maxLat: n }
}

/**
 * The favorites list. Signed out is a detour to sign in, same as
 * `/gita/nuova` — there is nowhere to send a stranger's list to.
 */
async function getFavorites(ctx: Ctx) {
  if (!ctx.account) {
    return redirect(ctx.res, 303, `/accedi?next=${encodeURIComponent('/preferiti')}`)
  }

  const rows = await listFavorites(ctx.db, ctx.account.id)
  send(ctx.res, 200, HTML, favoritesPage({ rows, viewer: ctx.account, csrf: ctx.csrf }))
}

/**
 * Info: the hub at /info, a subject at /info/<subject>, a scale's guide at
 * /info/scale/<scale>. What the old site footer held, and what Info grows into.
 */
async function getInfo(ctx: Ctx, path: InfoPath = { kind: 'hub' }) {
  const page = infoPage(path, { scales: scalesInUse(), viewer: ctx.account, csrf: ctx.csrf })
  return page ? send(ctx.res, 200, HTML, page) : notFound(ctx.res)
}

/**
 * Home: the line before anything is inferred.
 *
 * This replaces project 1's plain list of itineraries, which existed so the
 * archive was walkable before Find was built and said so in its own comment.
 */
/**
 * How many of the archive's routes the home map plots. There is no query to
 * shortlist by here, only a sample of what the archive holds — ungraded,
 * because grading is a query per route and nothing here asked for one.
 */
const HOME_MAP_SAMPLE = 300

/**
 * The open line's examples: the first candidates this archive answers as
 * typed, worked out once per archive — routes come with a deploy's seed, not
 * with a filed report. An archive that answers none of them gets its first
 * activity's name, a line that always finds something.
 */
const EXAMPLES = new WeakMap<Db, Promise<readonly string[]>>()
function exampleLines(db: Db, counts: readonly { id: string }[]): Promise<readonly string[]> {
  let found = EXAMPLES.get(db)
  if (!found) {
    found = (async () => {
      const kept: string[] = []
      for (const line of LINE_EXAMPLES) {
        if (kept.length === SHOWN_EXAMPLES) break
        if (await answersAsTyped(db, line)) kept.push(line)
      }
      const first = counts[0]?.id
      return kept.length ? kept : first ? [first.replace(/_/g, ' ')] : []
    })()
    EXAMPLES.set(db, found)
  }
  return found
}

async function getHome(ctx: Ctx) {
  const [counts, sample] = await Promise.all([
    activityCounts(ctx.db),
    searchItineraries(ctx.db, [], undefined, { limit: HOME_MAP_SAMPLE }),
  ])
  const examples = await exampleLines(ctx.db, counts)

  send(ctx.res, 200, HTML, homePage({
    activities: counts.map(c => ({
      id: c.id, n: c.n, label: ACTIVITIES[c.id]?.label.it ?? c.id,
    })),
    routes: await homeRoutes(ctx.db, sample),
    examples,
    viewer: ctx.account, csrf: ctx.csrf,
  }))
}

const HTML = 'text/html; charset=utf-8'

// Neither of these ever puts 'set-cookie' in the object handed to writeHead:
// a key given there overrides one set earlier with setHeader/appendHeader,
// which is exactly how route() attaches the CSRF cookie ahead of dispatch —
// naming 'set-cookie' here would silently drop it.
function send(res: http.ServerResponse, status: number, type: string, body: string | Buffer) {
  // A rendered page reflects account state (signed in or not, what is favorited,
  // what has been filed) at the moment it was built. Left uncached, the browser's
  // own back/forward history would otherwise show a stale copy after the visitor
  // mutates something elsewhere and navigates back — no-store is what stops that.
  // Static files get their own header, in serveFile.
  const headers: http.OutgoingHttpHeaders = { 'content-type': type }
  if (type === HTML) headers['cache-control'] = 'no-store'
  res.writeHead(status, headers)
  res.end(body)
}

function redirect(res: http.ServerResponse, status: number, location: string) {
  res.writeHead(status, { Location: location })
  res.end()
}

function methodNotAllowed(res: http.ServerResponse, allowed: readonly string[]) {
  res.writeHead(405, { 'content-type': HTML, Allow: allowed.join(', ') })
  res.end(render(html`<html lang="it"><title>Metodo non consentito</title>
    <p>Questo indirizzo non accetta questo metodo.</p>`))
}

function errorPage(res: http.ServerResponse, status: number) {
  const message = status === 413 ? 'Il modulo è troppo grande.' : 'Richiesta non valida.'
  send(res, status, HTML, render(html`<html lang="it"><title>Errore</title><p>${message}</p>`))
}

function notFound(res: http.ServerResponse) {
  send(res, 404, HTML, render(html`<html lang="it"><title>Non trovato</title>
    <p>Questo itinerario non c’è.</p>`))
}

async function itineraryFor(ctx: Ctx, id: string): Promise<string | null> {
  const it = await byId(ctx.db, id)
  if (!it) return null

  const schema = activityOf(it.activity)
  const parts = await partsOf(ctx.db, it.id)
  const gite = await giteFor(ctx.db, it.id)
  const now = new Date()
  // The sky where the route starts: a crag's wall, an alpine route's parking.
  const spot = weatherSpot(it)
  const weather = spot !== null && ctx.fetchWeather
    ? await weatherFor(ctx.db, spot.lat, spot.lon, spot.altitudeM, now, ctx.fetchWeather,
        { waitMs: FIRST_FETCH_WAIT_MS })
    : null
  // Only an activity whose page draws the parking-to-wall map asks for the
  // walk between them; an alpine route's second point is its summit.
  const drawsWalk = schema.rail.some(s => s.render === 'punti')
  const ends = accessPoints(it)
  const trail = drawsWalk && ctx.fetchTrail && ends.parking && ends.own
    ? await trailFor(ctx.db, ends.parking, ends.own, now, ctx.fetchTrail)
    : null

  // Only an activity whose panel draws a track, or whose page draws a profile, reads one.
  const drawsProfile = schema.document.some(s => s.render === 'profilo')
  const track = schema.rail.some(s => s.render === 'traccia') || drawsProfile ? await trackFor(ctx.db, it.id) : null
  // The profile is read from the terrain along the track, once; a first visit
  // waits for it as long as for the weather, then it lands in the background.
  const profile = drawsProfile && track && ctx.fetchTile
    ? await profileFor(ctx.db, it.id, track.points, now, ctx.fetchTile, { waitMs: FIRST_FETCH_WAIT_MS })
    : null

  const places = await ancestorsOf(ctx.db, it.placeId)
  const since = new Date(now.getTime() - schema.current.days * 86_400_000).toISOString().slice(0, 10)

  return itineraryPage({
    itinerary: it, schema, parts, trail, track: track?.points ?? null, profile, places,
    crumbLines: await crumbLines(ctx.db, { id: schema.id, label: schema.label.it }, places),
    facts: resolveFacts(schema, it.facts, parts),
    access: resolveAccessFacts(schema, it.facts, parts),
    // Only an activity whose rail lists nearby routes pays for the query; a crag's does not.
    nearby: schema.rail.some(s => s.render === 'vicine')
      ? await nearbyRoutes(ctx.db, it, {
        withinM: NEIGHBOUR_RADIUS_M, sameAspect: true, altToleranceM: ALT_TOLERANCE_M, since,
      })
      : [],
    // The map's pins: every route of the same activity around, alike or not.
    around: await nearbyRoutes(ctx.db, it, {
      withinM: MAP_NEIGHBOUR_RADIUS_M, sameAspect: false, altToleranceM: null, since,
    }),
    weather,
    stations: spot !== null ? await stationsNear(ctx.db, spot, STATION_RADIUS_M, STATIONS_SHOWN) : [],
    reportCount: gite.length,
    lastReportAt: gite[0]?.observedAt,
    reportDates: new Map(gite.map(g => [g.id, g.observedAt])),
    synthesis: await synthesisFor(ctx.db, it.id),
    photos: await photosFor(ctx.db, it.id),
    credits: await creditsOf(ctx.db, it.id),
    // The page is the same page for everyone; only the nav, the withdraw
    // control and the star read who is looking.
    viewer: ctx.account, csrf: ctx.csrf,
    isFavorite: ctx.account ? await isFavorite(ctx.db, ctx.account.id, it.id) : false,
  })
}

/** Every gita filed against one route, read in full — where the "leggi tutte" link goes. */
async function relazioniFor(ctx: Ctx, id: string): Promise<string | null> {
  const it = await byId(ctx.db, id)
  if (!it) return null

  return giteListPage({
    itineraryId: it.id, itineraryName: it.name,
    gite: await giteFor(ctx.db, it.id),
    photos: await photosFor(ctx.db, it.id),
    synthesis: await synthesisFor(ctx.db, it.id),
    // The theme or change picked in the index: the page filters to it, or
    // shows every report when the reading has nothing by that name.
    theme: ctx.url.searchParams.get('tema'),
    change: ctx.url.searchParams.get('cambio'),
    viewer: ctx.account, csrf: ctx.csrf,
  })
}

async function photosPageFor(ctx: Ctx, id: string): Promise<string | null> {
  const it = await byId(ctx.db, id)
  if (!it) return null

  return photosPage({
    itineraryId: it.id, itineraryName: it.name,
    photos: await photosFor(ctx.db, it.id),
    viewer: ctx.account, csrf: ctx.csrf,
  })
}

async function getFoto(ctx: Ctx, id: string, ext: 'jpg' | 'png') {
  // Retraction is the only way a photo stops showing — including its raw
  // bytes at this direct URL, not just its appearance in the rail and gallery.
  if (!(await standingPhoto(ctx.db, id))) return notFound(ctx.res)
  const mime = mimeForExt(ext)
  const bytes = await ctx.photos.get(id, mime)
  if (!bytes) return notFound(ctx.res)
  send(ctx.res, 200, mime, bytes)
}

/**
 * A static file — the stylesheet, a script, the map library, an image — is
 * sent with `no-cache` and an ETag of its bytes: a browser, and Cloudflare in
 * front of the deploy, may keep it but must ask again each time, and the
 * answer is a bodiless 304 until the file changes. Sent with no header at all,
 * Cloudflare kept .css and .js for hours on its own, and after a deploy a page
 * could get the new map-core.js beside the old stylesheet: the map's
 * clusters were drawn with no styles and vanished under the map.
 *
 * Asked for by the address that carries its hash (`?v=`, VERSIONS), it is
 * kept for good instead: that address can only ever mean these bytes. A `v`
 * that is not today's — a page rendered before a deploy, asking after it —
 * gets today's file under `no-cache`, so the wrong bytes are never kept under
 * an old address.
 */
/**
 * Addresses that name what a file is, not whose it is: the deploy's mark,
 * from its brand (`src/seed/sets/<set>/brand/`), and the contour ground, in
 * public/assets/bg/.
 */
function aliased(path: string): string | null {
  const mark = brand().mark
  switch (path) {
    case '/assets/logo/mark.svg': return mark.svg
    case '/assets/logo/mark-32.png': return mark.png32
    case '/assets/logo/mark-180.png': return mark.png180
    case '/assets/bg/ground.png': return join(ROOT, 'public', 'assets', 'bg', 'contour-ground.png')
    case '/assets/bg/height.u16': return join(ROOT, 'public', 'assets', 'bg', 'contour-heights.u16')
    default: return null
  }
}

async function serveFile(req: http.IncomingMessage, res: http.ServerResponse, path: string, version: string | null = null) {
  // Defence-in-depth, not the active guard: route()'s `new URL()` call already
  // collapses ".." out of `path` (per the WHATWG URL spec) before path ever
  // reaches here, so in practice this normalize() runs on an already-clean
  // string. It still matters — if a future change ever hands serveFile a raw,
  // un-normalized path (bypassing route()'s parsing), this is what stops
  // "/assets/../../etc/passwd" from resolving outside ROOT below.
  const rel = normalize(path).replace(/^(\.\.[/\\])+/, '')
  const file = path === '/app.css' || PUBLIC_SCRIPTS.includes(path) || path.startsWith('/vendor/')
    ? join(ROOT, 'public', path.slice(1))
    : aliased(path)
    // app.css asks for its background and photos at the root-relative
    // `/assets/...` the browser resolves against — served out of public/assets/.
    ?? (path.startsWith('/assets/') ? join(ROOT, 'public', rel) : join(ROOT, rel))
  if (!file.startsWith(ROOT)) return notFound(res)

  try {
    const body = await readFile(file)
    const etag = `"${createHash('sha1').update(body).digest('base64url')}"`
    const kept = version !== null && version === VERSIONS.get(path)
    const headers = { 'cache-control': kept ? 'public, max-age=31536000, immutable' : 'no-cache', etag }
    if (req.headers['if-none-match']?.split(/\s*,\s*/).includes(etag)) {
      res.writeHead(304, headers)
      res.end()
      return
    }
    res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', ...headers })
    res.end(body)
  } catch {
    notFound(res)
  }
}

if (import.meta.filename === process.argv[1]) {
  const { openDb } = await import('../db/open.ts')
  const { migrate } = await import('../../db/migrate.ts')
  const { checkRegistryAgainstStore } = await import('./startup-check.ts')
  const { realCallModel, realRewriteLine } = await import('./anthropic.ts')
  const { realFetchWeather } = await import('./weather-client.ts')
  const { realFetchTrail } = await import('./trail-client.ts')
  const { databaseFile, publicDemoSet } = await import('../seed/brand.ts')

  const db = openDb(databaseFile())
  await migrate(db)
  await checkRegistryAgainstStore(db)     // a bad deploy stops here, loudly
  const uploadsDir = process.env.UPLOADS_DIR ?? join(ROOT, 'uploads')
  const photoStore = filesystemPhotoStore(uploadsDir)
  const pendingPhotoStore = filesystemPhotoStore(join(uploadsDir, 'pending'))

  // No key is a state, not a model that finds nothing: said once here, and
  // `regenerateSynthesis` then leaves every existing synthesis alone rather
  // than overwriting it with an empty one on the next gita filed.
  let callModel: CallModel | null = null
  let rewriteLine: RewriteLine | null = null
  if (process.env.ANTHROPIC_API_KEY) {
    callModel = realCallModel(process.env.ANTHROPIC_API_KEY)
    rewriteLine = realRewriteLine(process.env.ANTHROPIC_API_KEY)
  } else {
    console.log('ANTHROPIC_API_KEY not set — relazioni synthesis and Find rewriting are disabled')
  }

  // Read before listening, so a half-configured deploy never opens at all.
  const { accessConfigFrom, accessGate, realFetchKeys } = await import('./access.ts')
  const accessConfig = accessConfigFrom(process.env)
  const access = accessConfig ? accessGate(accessConfig, realFetchKeys) : null
  if (accessConfig) console.log(`Cloudflare Access required (${accessConfig.issuer})`)

  // The public demonstration must never be the private archive opened to all.
  const publicDemo = process.env.PUBLIC_DEMO === '1'
  if (publicDemo) publicDemoSet()
  if (publicDemo) {
    console.log(`public demonstration, as ${brand().name}: one shared visitor account, everything written kept until a restart`)
    // Strangers spend the key here: Find's rewriting and the report reading share one ceiling.
    const { limitCallModel, limitRewriteLine } = await import('./model-budget.ts')
    const models = budget(DEMO_MODEL_CALLS)
    if (callModel) callModel = limitCallModel(callModel, models)
    if (rewriteLine) rewriteLine = limitRewriteLine(rewriteLine, models)
  }

  const port = Number(process.env.PORT ?? 3000)
  createServer(db, photoStore, pendingPhotoStore, callModel, realFetchWeather, rewriteLine, realFetchTrail, access, { publicDemo, fetchTile: fetchTerrainTile })
    .listen(port, () => console.log(`listening on :${port}`))

  // Routes whose reports arrived through the seed or an import, which no
  // filing ever regenerated. After listen, never awaited: requests do not wait
  // on it, and until it reaches a route the page says its themes are not yet
  // gathered, exactly as it did before.
  // Not on the demonstration, whose build read every report it holds: what
  // its budget allows is for what visitors write.
  if (!publicDemo) {
    backfillSyntheses(db, callModel, () => new Date())
      .catch(err => console.error('synthesis backfill failed:', err))
  }
}
