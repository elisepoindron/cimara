import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { execFileSync } from 'node:child_process'
import { mkdtemp, readdir, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import type http from 'node:http'
import { parseHTML } from 'linkedom'
import { openDb, type Db } from '../../src/db/open.ts'
import { allItineraries } from '../../src/db/itinerary.ts'
import { createServer } from '../../src/app/server.ts'
import { configureSite } from '../../src/render/site.ts'
import { loadBrand } from '../../src/seed/brand.ts'
import { groups, SCALE_GUIDES, SCALE_SLUG } from '../../src/render/info-content.ts'
import { memoryPhotoStore } from '../helpers/photo-store.ts'
import { NEVER_NAMED } from '../../src/import/osm/never-named.ts'

/**
 * The public deploy, as a visitor meets it: the demo set's archive, built by
 * `npm run demo:build` into a scratch file from the real extract and Phase 0's
 * content (the demo set's own content changes as it is written; this is a
 * fixed sample of it), the demo set's brand, `PUBLIC_DEMO`.
 * Nothing it serves may name the site whose brand is not ours to use.
 */
const ROOT = fileURLToPath(new URL('../../', import.meta.url))
const FORBIDDEN = NEVER_NAMED

let dir: string
let db: Db
let server: http.Server
let base: string

before(async () => {
  dir = await mkdtemp(join(tmpdir(), 'public-demo-'))
  const file = join(dir, 'demo.db')
  execFileSync(process.execPath, [
    '--disable-warning=ExperimentalWarning', join(ROOT, 'scripts/demo/build.ts'),
    '--content', join(ROOT, 'scripts/demo/phase0-content'),
  ], { stdio: 'ignore', env: { ...process.env, DATABASE_FILE: file, UPLOADS_DIR: join(dir, 'uploads') } })
  db = openDb(file)
  configureSite({ brand: loadBrand('demo') })
  server = createServer(db, memoryPhotoStore(), memoryPhotoStore(), null, null, null, null, null, { publicDemo: true })
  server.listen(0)
  await once(server, 'listening')
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`
})

after(async () => {
  server.close()
  await rm(dir, { recursive: true, force: true })
})

interface Got { readonly status: number; readonly body: string; readonly cookies: readonly string[] }

async function get(path: string, method = 'GET'): Promise<Got> {
  const res = await fetch(base + path, { method, redirect: 'manual' })
  return { status: res.status, body: await res.text(), cookies: res.headers.getSetCookie() }
}

/** The pages a visitor of the demonstration can reach. */
async function mainPages(): Promise<string[]> {
  const its = await allItineraries(db)
  const crag = its.find(i => i.activity === 'falesia')!
  const route = its.find(i => i.activity !== 'falesia')!
  const subjects = groups().flatMap(g => g.subjects).filter(s => !s.soon).map(s => `/info/${s.slug}`)
  const scales = SCALE_GUIDES.map(g => `/info/${SCALE_SLUG}/${g.slug}`)
  return [
    '/', '/trova?q=falesie', '/trova?q=falesie&scrivi=1',
    `/itinerario/${crag.id}`, `/itinerario/${crag.id}/relazioni`, `/itinerario/${crag.id}/foto`,
    `/itinerario/${route.id}`, `/itinerario/${route.id}/relazioni`,
    '/info', ...subjects, ...scales,
    '/accedi', '/registrati', '/preferiti', `/gita/nuova?itinerario=${route.id}`,
  ]
}

/** Every file under a folder, as paths relative to the repository. */
async function filesUnder(folder: string): Promise<string[]> {
  const entries = await readdir(join(ROOT, folder), { withFileTypes: true, recursive: true })
  return entries.filter(e => e.isFile()).map(e => join(e.parentPath, e.name).slice(ROOT.length))
}

test('no page of the public deploy names the private archive, nor sets a cookie that does', async () => {
  for (const path of await mainPages()) {
    const page = await get(path)
    assert.equal(page.status, 200, path)
    assert.doesNotMatch(page.body, FORBIDDEN, `${path} names it`)
    for (const c of page.cookies) assert.doesNotMatch(c.split('=')[0]!, FORBIDDEN, `${path} sets ${c}`)
  }
})

test('no file under public/ names the private archive, in its name or in its bytes', async () => {
  const files = await filesUnder('public')
  assert.ok(files.length > 10)
  for (const f of files) {
    assert.doesNotMatch(f, FORBIDDEN, f)
    assert.doesNotMatch((await readFile(join(ROOT, f))).toString('latin1'), FORBIDDEN, f)
  }
})

test('every local file a page asks for is served under a neutral address, with neutral bytes', async () => {
  const asked = new Set<string>()
  for (const path of await mainPages()) {
    const { document } = parseHTML((await get(path)).body)
    for (const el of document.querySelectorAll('[src],[href]')) {
      const ref = el.getAttribute('src') ?? el.getAttribute('href') ?? ''
      if (ref.startsWith('/') && !ref.startsWith('//') && /\.\w+(\?|$)/.test(ref)) asked.add(ref)
    }
  }
  // The stylesheet's own background and the ground's height field, which scripts fetch.
  for (const p of ['/assets/bg/ground.png', '/assets/bg/height.u16', '/favicon.ico']) asked.add(p)
  assert.ok([...asked].some(p => p.startsWith('/assets/logo/mark')))

  for (const path of asked) {
    assert.doesNotMatch(path, FORBIDDEN, path)
    const res = await fetch(base + path)
    assert.equal(res.status, 200, path)
    assert.doesNotMatch(Buffer.from(await res.arrayBuffer()).toString('latin1'), FORBIDDEN, path)
  }
})

test('the demo is Cimara, with its own mark, and offers no address to write to', async () => {
  const its = await allItineraries(db)
  const { document } = parseHTML((await get(`/itinerario/${its[0]!.id}`)).body)
  assert.match(document.querySelector('title')!.textContent!, / — Cimara$/)
  assert.equal(document.querySelector('.mark__w')!.textContent, 'Cimara')
  assert.equal(document.querySelectorAll('a[href^="mailto:"]').length, 0)

  const mark = await (await fetch(`${base}/assets/logo/mark.svg`)).text()
  assert.match(mark, /aria-label="Cimara"/)
  const info = parseHTML((await get('/info')).body).document
  assert.ok(![...info.querySelectorAll('.info__hub a')].some(a => a.getAttribute('href') === '/info/contatti'),
    'Contatti has nobody to name')
})

test('every page says the places are real and the reports invented, with the OpenStreetMap credit', async () => {
  for (const path of await mainPages()) {
    const { document } = parseHTML((await get(path)).body)
    const note = document.querySelector('.demo-note')
    assert.ok(note, `${path} has no notice`)
    assert.match(note.textContent!, /Dati inventati a scopo dimostrativo: i luoghi sono reali, le relazioni no\./, path)
    assert.equal(note.querySelector('a')!.getAttribute('href'), 'https://www.openstreetmap.org/copyright', path)
  }
})

test('every way to write answers that the demo is only for reading, and nothing is written', async () => {
  const its = await allItineraries(db)
  const id = its[0]!.id
  for (const path of ['/accedi', '/registrati', '/preferiti', `/gita/nuova?itinerario=${id}`]) {
    const page = await get(path)
    assert.equal(page.status, 200, `${path}: a page, not an error`)
    assert.match(page.body, /<h1>Solo lettura<\/h1>/, path)
  }
  for (const path of ['/accedi', '/registrati', '/esci', '/gita', '/gita/foto', `/preferiti/${id}`, `/preferiti/${id}/rimuovi`, '/gita/x/ritira']) {
    const page = await get(path, 'POST')
    assert.equal(page.status, 403, `${path}: nothing was done`)
    assert.match(page.body, /Solo lettura/, path)
  }
  const accounts = await db.get<{ n: number }>('SELECT count(*) AS n FROM account')
  assert.equal(accounts?.n, 0)
})

test('a crag nobody rated draws no line of dashes on the demo', async () => {
  const crag = (await allItineraries(db)).find(i => i.activity === 'falesia')!
  const { document } = parseHTML((await get(`/itinerario/${crag.id}`)).body)
  assert.equal(document.querySelectorAll('.cls--gz').length, 0)
})

test('the open line offers only what this archive answers', async () => {
  const { document } = parseHTML((await get('/')).body)
  const examples = JSON.parse(document.querySelector('.q__line')!.getAttribute('data-examples')!) as string[]
  assert.ok(examples.length > 0)
  assert.ok(!examples.some(e => /alpinismo/.test(e) && !/sci alpinismo/.test(e)), 'no alpinismo here to promise')
  for (const q of examples) {
    const doc = parseHTML((await get(`/trova?q=${encodeURIComponent(q)}`)).body).document
    assert.ok(doc.querySelectorAll('.r').length > 0, q)
  }
})
