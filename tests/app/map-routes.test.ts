import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running, type RunningServer } from '../helpers/http.ts'
import { seed } from '../../src/seed/seed.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'

const dom = (m: string) => parseHTML(m).document

async function archive(): Promise<RunningServer> {
  const s = await running()
  await seed(s.db)
  return s
}

async function get(base: string, path: string) {
  const res = await fetch(base + path)
  return { status: res.status, headers: res.headers, body: await res.text() }
}

test('home and a graded search both carry the map library; a page with nothing to map does not', async () => {
  const s = await archive()
  try {
    const home = dom((await get(s.base, '/')).body)
    assert.ok(home.querySelector('link[href*="maplibre-gl.css"]'), 'home carries the stylesheet')
    assert.ok(home.querySelector('script[src^="/home-map.js"]'), 'and its own client script')
    assert.ok(home.querySelector('#map'), 'and the container')

    const find = dom((await get(s.base, '/trova?q=alpinismo')).body)
    assert.ok(find.querySelector('link[href*="maplibre-gl.css"]'), 'find carries the stylesheet too')
    assert.ok(find.querySelector('script[src^="/find-map.js"]'), 'but its own client script, not home’s')
    assert.equal(find.querySelectorAll('script[src^="/home-map.js"]').length, 0)

    const signIn = dom((await get(s.base, '/accedi')).body)
    assert.equal(signIn.querySelectorAll('link[href*="maplibre-gl.css"]').length, 0,
      'a page with nothing to map pays for none of this')
    assert.equal(signIn.querySelectorAll('script[src^="/home-map.js"], script[src^="/find-map.js"]').length, 0)
  } finally { s.server.close() }
})

test('a route name that tries to end the data script early cannot reach the page as one', async () => {
  const s = await running()
  try {
    await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
    await insertItinerary(s.db, {
      id: 'i1', activity: 'alpinismo', placeId: 'p1',
      name: '</script><script>alert(1)</script>',
      lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
      facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
               esposizione: 'SE', giorni: 1 },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })

    const doc = dom((await get(s.base, '/')).body)
    assert.equal(doc.querySelectorAll('script').length, 8,
      'the shell’s import map and three motion scripts, the map’s data and module scripts, the page’s live module and its sheet — nothing the injected name opened')

    const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
    assert.ok(data.some((p: { name: string }) =>
      p.name === '</script><script>alert(1)</script>'))
  } finally { s.server.close() }
})

test('the client script is served as one', async () => {
  const s = await archive()
  try {
    const res = await fetch(s.base + '/home-map.js')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type')!, /javascript/)
  } finally { s.server.close() }
})

test('the vendored MapLibre library is served from /vendor/', async () => {
  const s = await archive()
  try {
    const script = await fetch(s.base + '/vendor/maplibre-gl.mjs')
    assert.equal(script.status, 200)
    assert.match(script.headers.get('content-type')!, /javascript/)

    const style = await fetch(s.base + '/vendor/maplibre-gl.css')
    assert.equal(style.status, 200)
    assert.match(style.headers.get('content-type')!, /css/)
  } finally { s.server.close() }
})

// maplibre-gl.mjs is not self-contained: it statically imports
// maplibre-gl-shared.mjs, which the worker chunk imports in turn — miss
// either one and the browser's module load throws before any map code runs,
// silently, in a way node --check/--test cannot see (they never execute
// module resolution). Both must be vendored and served alongside the two
// files above.
test('the two chunks maplibre-gl.mjs itself imports are served from /vendor/ too', async () => {
  const s = await archive()
  try {
    const shared = await fetch(s.base + '/vendor/maplibre-gl-shared.mjs')
    assert.equal(shared.status, 200)
    assert.match(shared.headers.get('content-type')!, /javascript/)

    const worker = await fetch(s.base + '/vendor/maplibre-gl-worker.mjs')
    assert.equal(worker.status, 200)
    assert.match(worker.headers.get('content-type')!, /javascript/)
  } finally { s.server.close() }
})

test('an itinerary with parking coordinates carries the map library; one without does not', async () => {
  const s = await running()
  try {
    await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
    await insertItinerary(s.db, {
      id: 'with-parking', activity: 'alpinismo', placeId: 'p1', name: 'Con parcheggio',
      lat: 44.6, lon: 7.1, parkingLat: 44.7007, parkingLon: 7.0960, aspect: 'SE', altMax: 3000,
      facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
               esposizione: 'SE', giorni: 1 },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })
    await insertItinerary(s.db, {
      id: 'without-parking', activity: 'alpinismo', placeId: 'p1', name: 'Senza parcheggio',
      lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
      facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
               esposizione: 'SE', giorni: 1 },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })

    const withParking = dom((await get(s.base, '/itinerario/with-parking')).body)
    assert.ok(withParking.querySelector('link[href*="maplibre-gl.css"]'))
    assert.ok(withParking.querySelector('script[src^="/parking-map.js"]'))

    const withoutParking = dom((await get(s.base, '/itinerario/without-parking')).body)
    assert.equal(withoutParking.querySelectorAll('link[href*="maplibre-gl.css"]').length, 0)
    assert.equal(withoutParking.querySelectorAll('script[src^="/parking-map.js"]').length, 0)
  } finally { s.server.close() }
})

test('find-map.js and map-core.js are served as scripts too', async () => {
  const s = await archive()
  try {
    const findScript = await fetch(s.base + '/find-map.js')
    assert.equal(findScript.status, 200)
    assert.match(findScript.headers.get('content-type')!, /javascript/)

    const core = await fetch(s.base + '/map-core.js')
    assert.equal(core.status, 200)
    assert.match(core.headers.get('content-type')!, /javascript/)
  } finally { s.server.close() }
})

test('every script a served script imports is served too', async () => {
  // A module whose import 404s fails as a whole: one forgotten name here and
  // the map it draws stays blank, with nothing on the page to say why.
  const { readdir, readFile } = await import('node:fs/promises')
  const dir = new URL('../../public/', import.meta.url)
  const imported = new Set<string>()
  for (const f of await readdir(dir)) {
    if (!f.endsWith('.js')) continue
    for (const m of (await readFile(new URL(f, dir), 'utf8')).matchAll(/from '\.\/([\w-]+\.js)'|import '\.\/([\w-]+\.js)'/g)) {
      imported.add(m[1] ?? m[2]!)
    }
  }
  assert.ok(imported.has('list-in-view.js'))
  const s = await archive()
  try {
    for (const name of imported) {
      const res = await fetch(s.base + '/' + name)
      assert.equal(res.status, 200, name)
    }
  } finally { s.server.close() }
})

test('a view in the address is read as west, south, east, north, and nonsense is ignored', async () => {
  const { viewOf } = await import('../../src/app/server.ts')
  assert.deepEqual(viewOf('7,44.5,8,45'), { minLon: 7, minLat: 44.5, maxLon: 8, maxLat: 45 })
  for (const bad of [null, '', '7,44,8', '8,44,7,45', '7,45,8,44', 'a,b,c,d', '7,44,8,95']) {
    assert.equal(viewOf(bad), null, String(bad))
  }
})

test('parking-map.js is served too', async () => {
  const s = await archive()
  try {
    const res = await fetch(s.base + '/parking-map.js')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type')!, /javascript/)
  } finally { s.server.close() }
})

test('crag-map.js is served too', async () => {
  const s = await archive()
  try {
    const res = await fetch(s.base + '/crag-map.js')
    assert.equal(res.status, 200)
    assert.match(res.headers.get('content-type')!, /javascript/)
  } finally { s.server.close() }
})
