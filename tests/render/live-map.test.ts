import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { render } from '../../src/render/html.ts'
import { homeMap, findMap, parkingMap, pointsMap, pinFacts, pinRecap, maplibreHead, type Pin } from '../../src/render/live-map.ts'

const dom = (m: string) => parseHTML(`<!doctype html><html><body>${m}</body></html>`).document

const pin = (o: Partial<Pin> = {}): Pin =>
  ({ id: 'i1', name: 'Prova', lat: 45.1, lon: 7.7, activity: 'alpinismo', ...o })

test('the map container is empty, ready for the client script to fill', () => {
  const doc = dom(render(homeMap([pin()])))
  assert.equal(doc.querySelectorAll('#map').length, 1)
  assert.equal(doc.querySelectorAll('#map canvas, #map svg').length, 0)
})

test('pins travel to the client exactly as the map data script holds them', () => {
  const doc = dom(render(homeMap([pin({ id: 'a' }), pin({ id: 'b', lat: null })])))
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data, [
    { id: 'a', name: 'Prova', lat: 45.1, lon: 7.7, activity: 'alpinismo' },
    { id: 'b', name: 'Prova', lat: null, lon: 7.7, activity: 'alpinismo' },
  ])
})

test('the client script is referenced as a module', () => {
  const doc = dom(render(homeMap([])))
  const script = doc.querySelector('script[src^="/home-map.js"]')
  assert.ok(script, 'the script tag is present')
  assert.equal(script!.getAttribute('type'), 'module')
})

test('a route name cannot end the data script early', () => {
  const doc = dom(render(homeMap([pin({ name: '</script><script>alert(1)</script>' })])))

  // If the escaping failed, the injected `</script>` would end #map-data
  // early and the text after it would parse as a second, real <script> —
  // exactly the two this page is supposed to have, plus one it must not.
  assert.equal(doc.querySelectorAll('script').length, 2,
    'the data script and the module script — nothing the name opened')
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.equal(data[0].name, '</script><script>alert(1)</script>')
})

test('the MapLibre stylesheet is exported for extraHead, not baked into every page', () => {
  const doc = dom(render(maplibreHead()))
  const link = doc.querySelector('link[rel="stylesheet"]')
  assert.ok(link)
  assert.match(link!.getAttribute('href')!, /maplibre-gl\.css/)
})

test('findMap threads a pin’s activity through to the client, which colours it', () => {
  const doc = dom(render(findMap([pin({ id: 'a', activity: 'falesia' }), pin({ id: 'b' })])))
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data, [
    { id: 'a', name: 'Prova', lat: 45.1, lon: 7.7, activity: 'falesia' },
    { id: 'b', name: 'Prova', lat: 45.1, lon: 7.7, activity: 'alpinismo' },
  ])
})

test('every activity in the registry has its colour in the stylesheet', async () => {
  const { readFile } = await import('node:fs/promises')
  const { ACTIVITIES } = await import('../../src/domain/activities/index.ts')
  const css = await readFile(new URL('../../public/app.css', import.meta.url), 'utf8')
  for (const id of Object.keys(ACTIVITIES)) {
    assert.match(css, new RegExp(`--act-${id}:#[0-9A-Fa-f]{6}`), `${id} has a pin colour`)
  }
})

test('findMap references its own client script, not home’s', () => {
  const doc = dom(render(findMap([])))
  const script = doc.querySelector('script[src^="/find-map.js"]')
  assert.ok(script, 'the script tag is present')
  assert.equal(script!.getAttribute('type'), 'module')
})

test('a route name cannot end findMap’s data script early either', () => {
  const doc = dom(render(findMap([pin({ name: '</script><script>alert(1)</script>' })])))
  assert.equal(doc.querySelectorAll('script').length, 2)
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.equal(data[0].name, '</script><script>alert(1)</script>')
})

test('parkingMap places one marker, not a Pin — no id, nothing to click through to', () => {
  const doc = dom(render(parkingMap(44.7007, 7.0960, 'Cresta Est')))
  assert.equal(doc.querySelectorAll('#map').length, 1)
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data, { lat: 44.7007, lon: 7.0960, label: 'Cresta Est' })
})

test('parkingMap references its own client script', () => {
  const doc = dom(render(parkingMap(44.7, 7.1, 'Prova')))
  const script = doc.querySelector('script[src^="/parking-map.js"]')
  assert.ok(script)
  assert.equal(script!.getAttribute('type'), 'module')
})

test('a route name cannot end parkingMap’s data script early', () => {
  const doc = dom(render(parkingMap(44.7, 7.1, '</script><script>alert(1)</script>')))
  assert.equal(doc.querySelectorAll('script').length, 2)
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.equal(data.label, '</script><script>alert(1)</script>')
})

test('parkingMap’s label reaches the container’s own aria-label too, escaped the ordinary way', () => {
  const doc = dom(render(parkingMap(44.7, 7.1, 'Balma "Scura"')))
  const label = doc.querySelector('#map')!.getAttribute('aria-label')!
  assert.match(label, /Balma "Scura"/)
})

test('parkingMap’s container is a group, not an image — role="img" would hide the ' +
  'NavigationControl and attribution MapLibre injects inside it from assistive tech', () => {
  const doc = dom(render(parkingMap(44.7, 7.1, 'Prova')))
  assert.equal(doc.querySelector('#map')!.getAttribute('role'), 'group')
})

test('parkingMap has a noscript fallback, like home’s and Find’s maps', () => {
  const doc = dom(render(parkingMap(44.7, 7.1, 'Prova')))
  assert.equal(doc.querySelectorAll('#map noscript').length, 1)
})

test('parkingMap carries the itinerary’s own point too, when it has one', () => {
  const doc = dom(render(parkingMap(44.7007, 7.0960, 'Cresta Est', 44.6673, 7.0913)))
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data, {
    lat: 44.7007, lon: 7.0960, label: 'Cresta Est',
    itineraryLat: 44.6673, itineraryLon: 7.0913,
  })
})

test('parkingMap’s aria-label names the itinerary’s own point too, when it has one — ' +
  'the two markers differ only by colour otherwise', () => {
  const doc = dom(render(parkingMap(44.7, 7.1, 'Prova', 44.6, 7.0)))
  const label = doc.querySelector('#map')!.getAttribute('aria-label')!
  assert.match(label, /posizione di Prova/)
})

test('a crag name cannot break out of the points map’s label', () => {
  const out = render(pointsMap({ lat: 1, lon: 2 }, null, '</script><b>x', null)!)
  assert.equal(out.includes('</script><b>'), false)
})

test('the points map loads its own client script', () => {
  const out = render(pointsMap(null, { lat: 1, lon: 2 }, 'Balma Scura', null)!)
  assert.match(out, /<script type="module" src="\/crag-map\.js"><\/script>/)
  assert.equal(pointsMap(null, null, 'Balma Scura', null), null)
})

test('a pin’s card takes the row’s facts in order, and no more than three', () => {
  const fact = (label: string, text: string) =>
    ({ kind: 'fact' as const, icon: 'grado' as const, label, text, aspect: null })
  assert.deepEqual(pinFacts([fact('Difficoltà', 'AD'), null, { kind: 'distance', km: 41.6 },
    fact('Esposizione', 'SE'), fact('Giorni', '1')]), [
    { label: 'Difficoltà', text: 'AD' },
    { label: 'Distanza', text: '42 km' },
    { label: 'Esposizione', text: 'SE' },
  ])
})

test('a crag’s grade bars become its range on the card, one grade where there is one', () => {
  const bars = (grades: string[]) => ({
    kind: 'histogram' as const, scale: 'french' as never, total: grades.length, each: 'via', many: 'vie',
    counts: grades.map((grade, i) => ({ ordinal: i, grade, n: 1 })),
  })
  assert.deepEqual(pinFacts([bars(['5c', '6a', '7a'])]), [{ label: 'Gradi', text: '5c–7a' }])
  assert.deepEqual(pinFacts([bars(['6a'])]), [{ label: 'Gradi', text: '6a' }])
})

test('a card names the activity by its label, and says nothing of conditions unless given them', () => {
  assert.deepEqual(pinRecap('alpinismo', 'CN Crissolo', []),
    { kind: 'Alpinismo', where: 'CN Crissolo', facts: [] })
  const state = { tint: 't2', label: 'Buone', said: '3 osservazioni' }
  assert.deepEqual(pinRecap('alpinismo', 'CN Crissolo', [], state).state, state)
})

test('a pin’s card travels with it in the map data', () => {
  const recap = pinRecap('falesia', 'TO Locana', [])
  const doc = dom(render(homeMap([pin({ recap })])))
  const [data] = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data.recap, recap)
})

test('the crag’s map carries the other crags around it as pins, the ones without coordinates left out', () => {
  const out = render(pointsMap({ lat: 1, lon: 2 }, { lat: 1.01, lon: 2 }, 'Balma Scura', null, null,
    [pin({ id: 'vicina', activity: 'falesia' }), pin({ id: 'persa', lat: null })])!)
  const data = JSON.parse(dom(out).querySelector('#map-data')!.textContent!)
  assert.deepEqual(data.around, [{ id: 'vicina', name: 'Prova', lat: 45.1, lon: 7.7, activity: 'falesia' }])
})

test('with nothing around, neither map carries an around field', () => {
  const crag = JSON.parse(dom(render(pointsMap({ lat: 1, lon: 2 }, null, 'X', null)!)).querySelector('#map-data')!.textContent!)
  const alp = JSON.parse(dom(render(parkingMap(44.7, 7.1, 'Y'))).querySelector('#map-data')!.textContent!)
  assert.equal('around' in crag, false)
  assert.equal('around' in alp, false)
})

test('the alpine parking map carries the other alpine routes around as pins', () => {
  const doc = dom(render(parkingMap(44.7, 7.1, 'Cresta Est', 44.66, 7.09, [pin({ id: 'vicino' })])))
  const data = JSON.parse(doc.querySelector('#map-data')!.textContent!)
  assert.deepEqual(data.around.map((p: { id: string }) => p.id), ['vicino'])
})

test('a neighbour’s name cannot end the crag map’s data script early', () => {
  const out = render(pointsMap({ lat: 1, lon: 2 }, null, 'X', null, null, [pin({ name: '</script><b>x' })])!)
  const doc = dom(out)
  assert.equal(doc.querySelectorAll('script').length, 2)
  assert.equal(JSON.parse(doc.querySelector('#map-data')!.textContent!).around[0].name, '</script><b>x')
})
