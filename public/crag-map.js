// A crag's two points — where to park, and the wall — as two shapes rather
// than two colours: the square and the triangle the rows above the map use,
// cloned from those rows so the rows are the legend. The walk joins them,
// labelled with the approach time. Where the server found the walk on mapped
// paths (`trail`), the line follows it, solid; otherwise it is straight and
// dashed, showing how far apart the two are, not the way to walk.
//
// Around them, every other crag nearby (`around`), as drops in the
// activity's colour that open the same card as on Find, each a way to the
// crag next door. A click on a drop opens its card; a click anywhere else on
// the map (a drag still pans it) opens it large: a second map,
// built on first open, grows out of the small one to fill the window and
// shrinks back into it on close (×, Esc, or a click on the dimmed page).
// See its design spec §2 and
// its design spec.
import * as maplibregl from '/vendor/maplibre-gl.mjs'
import {
  readColor, STYLE, fitToFeatures, shapeFromRow, addClusteredLayer, toFeatures, activityColor,
  smallMapPadding, foldAttribution, withGround,
} from './map-core.js'

// A hike's track comes through here too: `goal` names the row whose shape
// marks its far end (a crag's wall `f`, a hike's highest point `v`), and
// `ends: false` leaves out the dotted gaps a router's path has and a
// recorded track does not.
const { parking, crag, approach, trail, big, around = [], goal = 'f', ends: dotEnds = true } =
  JSON.parse(document.getElementById('map-data').textContent)
const first = parking ?? crag
const container = document.getElementById('map')

const point = c => ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: c } })
const ends = parking && crag ? [[parking.lon, parking.lat], [crag.lon, crag.lat]] : []
const line = trail ? trail.coords : ends
const framed = (ends.length ? [...ends, ...line] : [[first.lon, first.lat]]).map(point)
// The view stays framed on the walk, small or large: the neighbours are
// there for whoever pans or zooms out to look around, never a reason to
// move the map on its own.
const neighbours = toFeatures(around, activityColor())
const NEAR_LAYERS = ['near-points', 'near-clusters']

/** The other crags, above the walk and under the two shapes (markers sit over every layer). */
function drawNeighbours(map) {
  if (neighbours.length) addClusteredLayer(map, 'near', neighbours)
}

/** Everything both maps draw: the two shapes, the walk, its label. `large` thickens the line. */
function draw(map, large) {
  const addShape = (kind, p) => {
    const element = shapeFromRow(kind)
    if (element) new maplibregl.Marker({ element }).setLngLat([p.lon, p.lat]).addTo(map)
  }
  if (parking) addShape('p', parking)
  if (crag) addShape(goal, crag)
  if (!parking || !crag) return drawNeighbours(map)

  map.addSource('walk', {
    type: 'geojson',
    data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line } },
  })

  if (trail && dotEnds) {
    // The router starts and ends on the nearest mapped path, which a car park
    // or the foot of a wall is often a little off: those ends are dotted, as
    // a walk the map knows nothing about always is.
    const path = trail.coords
    map.addSource('walk-ends', {
      type: 'geojson',
      data: { type: 'Feature', properties: {}, geometry: { type: 'MultiLineString',
        coordinates: [[ends[0], path[0]], [path[path.length - 1], ends[1]]] } },
    })
    map.addLayer({
      id: 'walk-ends', type: 'line', source: 'walk-ends',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': readColor('--frame'), 'line-width': 1.6, 'line-dasharray': [0.5, 2.5] },
    })
  }
  if (trail) {
    // A pale casing under the path, so it reads over the tiles' own trails
    // and contours rather than merging into them.
    map.addLayer({
      id: 'walk-casing', type: 'line', source: 'walk',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': readColor('--pap'), 'line-width': large ? 7 : 5, 'line-opacity': 0.85 },
    })
    map.addLayer({
      id: 'walk', type: 'line', source: 'walk',
      layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': readColor('--ver'), 'line-width': large ? 3.4 : 2.4 },
    })
  } else {
    map.addLayer({
      id: 'walk', type: 'line', source: 'walk',
      layout: { 'line-cap': 'round' },
      paint: { 'line-color': readColor('--frame'), 'line-width': 1.6, 'line-dasharray': [0.5, 2.5] },
    })
  }

  if (approach) {
    const label = document.createElement('span')
    label.className = 'pk__walk'
    label.textContent = approach
    const at = trail ? trail.labelAt : [(parking.lon + crag.lon) / 2, (parking.lat + crag.lat) / 2]
    new maplibregl.Marker({ element: label }).setLngLat(at).addTo(map)
  }
  drawNeighbours(map)
}

const small = withGround(new maplibregl.Map({ container, style: STYLE, center: [first.lon, first.lat], zoom: 15 }))
small.addControl(new maplibregl.NavigationControl(), 'top-right')
foldAttribution(small)
small.on('load', () => {
  draw(small, false)
  // Framed to hold the whole walk, which can bend well outside the box of its
  // two ends. Wider on the right and bottom, where MapLibre's zoom control and
  // attribution sit, so neither shape lands under them.
  fitToFeatures(small, framed, { maxZoom: 16, padding: smallMapPadding(container) })
})

// ---- opened large ----

const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches
let veil, sheet, large, closeButton, returnFocus, isOpen = false

function build() {
  veil = Object.assign(document.createElement('div'), { className: 'mapveil' })
  sheet = Object.assign(document.createElement('div'), { className: 'mapbig' })
  sheet.setAttribute('role', 'dialog')
  sheet.setAttribute('aria-modal', 'true')
  sheet.setAttribute('aria-label', big.title)
  const holder = Object.assign(document.createElement('div'), { className: 'mapbig__map' })
  const cap = Object.assign(document.createElement('div'), { className: 'mapbig__cap' })
  cap.append(Object.assign(document.createElement('h3'), { textContent: big.title }))
  if (big.summary) cap.append(Object.assign(document.createElement('p'), { textContent: big.summary }))
  closeButton = Object.assign(document.createElement('button'),
    { className: 'mapbig__x', type: 'button', textContent: '×' })
  closeButton.setAttribute('aria-label', 'Chiudi la mappa')
  sheet.append(holder, cap, closeButton)
  // On the body, so no transformed ancestor traps the fixed sheet; the shapes
  // are still cloned from the rows around the small map (shapeFromRow).
  document.body.append(veil, sheet)

  large = withGround(new maplibregl.Map({ container: holder, style: STYLE, center: small.getCenter(), zoom: small.getZoom() }))
  large.addControl(new maplibregl.NavigationControl(), 'top-right')
  large.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-left')
  large.on('load', () => draw(large, true))

  veil.addEventListener('click', close)
  closeButton.addEventListener('click', close)
}

/** The transform that lays the full-window sheet exactly over the small map. */
function overSmall() {
  const r = container.getBoundingClientRect()
  const t = sheet.getBoundingClientRect()
  return `translate(${r.left - t.left}px, ${r.top - t.top}px) scale(${r.width / t.width}, ${r.height / t.height})`
}

function open() {
  if (isOpen) return
  isOpen = true
  returnFocus = document.activeElement
  if (!sheet) build()
  document.documentElement.classList.add('mapbig-open')
  sheet.classList.add('on')
  veil.classList.add('on')
  large.resize()
  large.jumpTo({ center: small.getCenter(), zoom: small.getZoom() })
  fitToFeatures(large, framed, { maxZoom: 17, padding: 110, duration: reduce ? 0 : 700 })
  if (!reduce) {
    sheet.animate([{ transform: overSmall() }, { transform: 'none' }],
      { duration: 460, easing: 'cubic-bezier(.2,.8,.2,1)' })
  }
  closeButton.focus()
}

async function close() {
  if (!isOpen) return
  isOpen = false
  veil.classList.remove('on')
  if (!reduce) {
    await sheet.animate([{ transform: 'none' }, { transform: overSmall() }],
      { duration: 340, easing: 'cubic-bezier(.4,0,.6,1)' }).finished
  }
  sheet.classList.remove('on')
  document.documentElement.classList.remove('mapbig-open')
  returnFocus?.focus?.()
}

addEventListener('keydown', e => { if (e.key === 'Escape') close() })

// MapLibre's click fires only when the pointer did not drag, so panning the
// small map never opens it. A zoom button is a control, not the map: no click.
// Nor is a neighbour's drop, which opens its own card, or a cluster of them,
// which zooms in.
container.classList.add('pk__map--zoom')
small.on('click', e => {
  const layers = NEAR_LAYERS.filter(id => small.getLayer(id))
  if (layers.length && small.queryRenderedFeatures(e.point, { layers }).length) return
  open()
})

// The map itself is not a keyboard target; this button is, shown only when focused.
const keyOpen = Object.assign(document.createElement('button'),
  { className: 'mapbig__open', type: 'button', textContent: 'Ingrandisci la mappa' })
keyOpen.addEventListener('click', open)
container.append(keyOpen)
