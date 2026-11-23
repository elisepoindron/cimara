// Shared MapLibre wiring: the tile style, colour resolution, pin-to-feature
// conversion, map construction, clustering, and fit-to-bounds. Used in full by
// home-map.js and find-map.js; parking-map.js and crag-map.js take the tile
// style, the ground under it, the fit and the row-cloned shape markers, since
// they build their own map.
// See the map-everywhere design spec.

/** The one tile style every map on the site draws — chosen once, kept in one place. */
export const STYLE = 'https://tiles.openfreemap.org/styles/liberty'

// The ground under it, chosen in a design study (H).
// Far off, the vector style above with relief: OpenTopoMap's elevation bands,
// softened, and a shaded relief, both from Mapterhorn's keyless terrain tiles.
// From about the scale of a valley, OpenTopoMap itself, with its paths and huts.
const TERRAIN = {
  type: 'raster-dem',
  // Mapterhorn rather than AWS's terrain tiles: served over HTTP/2 from a CDN,
  // in tiles four times the area, so the home's relief is a dozen requests
  // rather than forty slow ones.
  tiles: ['https://tiles.mapterhorn.com/{z}/{x}/{y}.webp'],
  encoding: 'terrarium',
  // The images are 512 px but declared at 256, so each screen pixel is drawn
  // from two of elevation: the ridges come out sharp rather than soft.
  tileSize: 256,
  maxzoom: 12,
  attribution: '<a href="https://mapterhorn.com/attribution">© Mapterhorn</a>',
}
const TOPO = {
  type: 'raster',
  tiles: ['a', 'b', 'c'].map(s => `https://${s}.tile.opentopomap.org/{z}/{x}/{y}.png`),
  tileSize: 256,
  maxzoom: 17,
  attribution: '© <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA) · SRTM',
}
// Past this, OpenTopoMap covers the relief, so the relief stops asking for tiles.
const RELIEF_MAX_ZOOM = 10.5
// The hand-over. The vector style's roads, rivers and land stay drawn the whole
// way: OpenTopoMap draws them in the same places, so as it fades in (9.9 → 10.2)
// it lands on them and then covers them. Only the names leave, just before
// (9.7 → 9.9), so two sets of names never show at once. Zooming out runs it
// backwards.
const NAMES_OUT = ['interpolate', ['linear'], ['zoom'], 9.7, 1, 9.9, 0]
const TOPO_IN = ['interpolate', ['linear'], ['zoom'], 9.9, 0, 10.2, 1]

/**
 * Lays the relief and OpenTopoMap under whatever the page draws next. Must be
 * registered before any other `load` handler, so the pins and walks the page
 * adds afterwards land above the ground — `createMap` does it; the maps that
 * build their own call it right after `new maplibregl.Map`.
 */
export function withGround(map) {
  map.on('load', () => {
    if (map.getLayer('natural_earth')) map.removeLayer('natural_earth')
    const layers = map.getStyle().layers
    for (const l of layers) {
      if (l.type === 'symbol') {
        map.setPaintProperty(l.id, 'text-opacity', NAMES_OUT)
        map.setPaintProperty(l.id, 'icon-opacity', NAMES_OUT)
      } else if (l.type === 'fill-extrusion') {
        map.setLayoutProperty(l.id, 'visibility', 'none')
      }
    }
    const firstWater = layers.find(l => /^water/.test(l.id))?.id
    map.addSource('terrain', TERRAIN)
    // OpenTopoMap's bands in its order, gentler, and fainter far off so the
    // Alps are never one red-brown mass.
    map.addLayer({
      id: 'ground-bands', type: 'color-relief', source: 'terrain', maxzoom: RELIEF_MAX_ZOOM,
      paint: {
        'color-relief-opacity': ['interpolate', ['linear'], ['zoom'], 7, 0.55, 10, 0.7],
        'color-relief-color': ['interpolate', ['linear'], ['elevation'],
          0, '#B9D7A6', 300, '#CFE2A8', 700, '#EEE8A8', 1200, '#E9CF94', 1700, '#D9AE7E',
          2300, '#C8987A', 2800, '#BDB2A8', 3300, '#E6E2DE', 3800, '#FFFFFF'],
      },
    }, firstWater)
    map.addLayer({
      id: 'ground-shade', type: 'hillshade', source: 'terrain', maxzoom: RELIEF_MAX_ZOOM,
      paint: {
        'hillshade-method': 'igor',
        'hillshade-illumination-direction': 315,
        'hillshade-shadow-color': 'rgba(50,42,34,0.65)',
        'hillshade-highlight-color': 'rgba(255,255,255,0.4)',
        'hillshade-accent-color': 'rgba(50,42,34,0.3)',
        'hillshade-exaggeration': 0.55,
      },
    }, firstWater)
    map.addSource('topo', TOPO)
    map.addLayer({
      id: 'ground-topo', type: 'raster', source: 'topo', minzoom: 9.8,
      paint: { 'raster-opacity': TOPO_IN, 'raster-fade-duration': 0 },
    })
  })
  return map
}

/**
 * A marker element drawn from the same svg as the panel row `.pk__<kind>`, so
 * the rows above a map are its legend; null where the page has no such row.
 */
export function shapeFromRow(kind) {
  const section = document.getElementById('map').closest('section')
  const icon = section && section.querySelector(`.pk__${kind} .pk__ic`)
  if (!icon) return null
  const el = document.createElement('div')
  el.className = 'pk__mk'
  el.innerHTML = icon.outerHTML
  return el
}

/** Read a CSS custom property's resolved value — never a hardcoded hex. */
export function readColor(varName) {
  return getComputedStyle(document.documentElement).getPropertyValue(varName).trim()
}

/** Reads the pins the server embedded in `#map-data`, keeping only those with real coordinates. */
export function readLocatedPins() {
  const pins = JSON.parse(document.getElementById('map-data').textContent)
  return pins.filter(p => typeof p.lat === 'number' && typeof p.lon === 'number')
}

/**
 * Turns located pins into GeoJSON point features, colouring each one via
 * `colorFor` — each pin in its activity's colour (see `activityColor`).
 */
export function toFeatures(pins, colorFor) {
  return pins.map(p => ({
    type: 'Feature',
    // A feature's properties are flattened to strings by the map's worker, so
    // the card's words travel as one JSON string and are parsed back on click.
    properties: { id: p.id, name: p.name, color: colorFor(p), recap: JSON.stringify(p.recap ?? null) },
    geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
  }))
}

/**
 * Builds the map every clustered view starts from: same style, same
 * top-right zoom control, same fallback extent before `fitToFeatures` (or a
 * `load` handler) narrows it. Takes the `maplibregl` module itself rather
 * than importing it here, so this file stays a plain helper module and not
 * another thing that loads the map library.
 */
export function createMap(maplibregl) {
  const map = new maplibregl.Map({
    container: 'map',
    style: STYLE,
    center: [12.5, 42],
    zoom: 5,
    // Always the ⓘ button, whatever the map's width: the credits are one tap
    // away rather than a bar along the foot of the map, under the key.
    attributionControl: { compact: true },
  })
  withGround(map)
  map.addControl(new maplibregl.NavigationControl(), 'top-right')
  foldAttribution(map)
  return map
}

/**
 * Adds a clustered GeoJSON source and its layers to `map`, under
 * `sourceId`. Each feature in `features` must already carry a `color`
 * property (a real hex) in its own `properties` — that is what lets this one
 * function serve every map whatever its pins mean (today, each its activity's
 * colour, resolved per pin before this is called): the drop image here is
 * picked by the data-driven expression `['get', 'color']`, so this function
 * never has to know which pin means what colour, only that each one already
 * carries its own.
 *
 * Wires the click/hover behaviour every map on this site shares: clicking an
 * individual point opens its card (see `pinCard`), and the card or a second
 * click on the same point goes to the route; clicking a cluster eases the
 * view to its expansion zoom, and the cursor becomes a pointer over either.
 *
 * A cluster is drawn as frosted glass ringed by the activities inside it (see
 * `clusterRings`). The map's own circle layer stays underneath, transparent,
 * as what a click, the pointer and `queryRenderedFeatures` find: the ring is
 * only a picture of it.
 */
export function addClusteredLayer(map, sourceId, features) {
  const palette = clusterPalette(features)
  map.addSource(sourceId, {
    type: 'geojson',
    data: { type: 'FeatureCollection', features },
    cluster: true,
    clusterMaxZoom: 14,
    clusterRadius: 50,
    // How many of a cluster's pins are each colour, as `c0`, `c1`… in the
    // order of `palette`: the ring is drawn from these counts.
    clusterProperties: Object.fromEntries(palette.map((color, i) =>
      [`c${i}`, ['+', ['case', ['==', ['get', 'color'], color], 1, 0]]])),
  })

  const clustersLayer = `${sourceId}-clusters`
  const pointsLayer = `${sourceId}-points`

  map.addLayer({
    id: clustersLayer,
    type: 'circle',
    source: sourceId,
    filter: ['has', 'point_count'],
    paint: {
      'circle-color': '#000000',
      'circle-opacity': 0,
      'circle-radius': ['step', ['get', 'point_count'], CLUSTER_SIZE[0] / 2, 10, CLUSTER_SIZE[1] / 2, 50, CLUSTER_SIZE[2] / 2],
    },
  })
  const rings = clusterRings(map, sourceId, palette)

  // Each point is a drop, drawn once per colour it is asked for and kept as a
  // map image named after that colour; the clicked one is redrawn larger in a
  // layer of its own, since a symbol's size cannot follow a feature's state.
  const dropOf = ['concat', 'drop:', ['get', 'color']]
  ensureDrops(map, features.map(f => f.properties.color))
  map.on('styleimagemissing', e => {
    if (e.id.startsWith('drop:')) addDrop(map, e.id.slice(5))
  })

  map.addLayer({
    id: pointsLayer,
    type: 'symbol',
    source: sourceId,
    filter: ['!', ['has', 'point_count']],
    layout: {
      'icon-image': dropOf,
      'icon-anchor': 'bottom',
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  map.addLayer({
    id: `${sourceId}-chosen`,
    type: 'symbol',
    source: sourceId,
    filter: ['==', ['get', 'id'], ''],
    layout: {
      'icon-image': dropOf,
      'icon-anchor': 'bottom',
      'icon-size': 1.2,
      'icon-allow-overlap': true,
      'icon-ignore-placement': true,
    },
  })

  const card = pinCard(map, sourceId)
  map.on('click', pointsLayer, e => {
    e.preventDefault()
    card.open(e.features[0])
  })
  map.on('click', e => {
    if (!e.defaultPrevented) card.close()
  })
  map.on('move', card.place)
  map.on('zoomstart', card.close)
  map.on('pins:replaced', card.close)
  document.addEventListener('keydown', e => {
    if (e.key === 'Escape') card.close()
  })

  map.on('click', clustersLayer, async e => {
    e.preventDefault()
    card.close()
    const clusterId = e.features[0].properties.cluster_id
    const center = e.features[0].geometry.coordinates
    const zoom = await map.getSource(sourceId).getClusterExpansionZoom(clusterId)
    map.easeTo({ center, zoom })
  })

  for (const layer of [clustersLayer, pointsLayer]) {
    map.on('mouseenter', layer, () => { map.getCanvas().style.cursor = 'pointer' })
    map.on('mouseleave', layer, () => { map.getCanvas().style.cursor = '' })
  }
  map.on('mousemove', clustersLayer, e => rings.hover(e.features[0].properties.cluster_id))
  map.on('mouseleave', clustersLayer, () => rings.hover(null))
}

/** A cluster's diameter in pixels: under ten pins, under fifty, fifty and more. */
const CLUSTER_SIZE = [32, 40, 50]

/** How many activities a ring names by colour; any others share one grey segment. */
const RING_COLOURS = 4

/**
 * Every colour a pin can be, in a fixed order: each `--act-*` the stylesheet
 * defines, `--faint` for an activity it does not, and any colour among
 * `features` that is neither. The cluster counts are set once, when the
 * source is made, so they must already cover the pins Find swaps in later.
 */
function clusterPalette(features) {
  const colors = new Set()
  for (const sheet of document.styleSheets) {
    let rules
    try { rules = sheet.cssRules } catch { continue }
    for (const rule of rules) {
      if (rule.selectorText !== ':root') continue
      for (const name of rule.style) {
        if (name.startsWith('--act-')) colors.add(rule.style.getPropertyValue(name).trim())
      }
    }
  }
  colors.add(readColor('--faint'))
  for (const f of features) colors.add(f.properties.color)
  return [...colors].filter(Boolean)
}

/**
 * Draws each cluster over the map: a disc of frosted glass, its count, and a
 * fine ring split by the activities inside it, in proportion — the four
 * largest in their colours, the rest as one grey segment, so a ring never has
 * more than five whatever the mix. Redrawn on every render, where the source's
 * clusters are; a cluster that appears rises in, and the one under the pointer
 * grows a little (`hover`).
 */
function clusterRings(map, sourceId, palette) {
  const layer = document.createElement('div')
  layer.className = 'mk-layer'
  layer.setAttribute('aria-hidden', 'true')
  // Right above the map's canvas, so every marker (the crag's two shapes)
  // and the pin card stay over the rings, whenever they were added.
  map.getCanvas().after(layer)
  const live = new Map()
  let hovered = null

  map.on('render', () => {
    if (!map.getSource(sourceId) || !map.isSourceLoaded(sourceId)) return
    const seen = new Set()
    for (const f of map.querySourceFeatures(sourceId)) {
      const p = f.properties
      if (!p.cluster || seen.has(p.cluster_id)) continue
      seen.add(p.cluster_id)
      let el = live.get(p.cluster_id)
      if (!el) {
        el = clusterRing(p, palette)
        el.classList.toggle('is-hover', p.cluster_id === hovered)
        layer.append(el)
        live.set(p.cluster_id, el)
      }
      const { x, y } = map.project(f.geometry.coordinates)
      el.style.transform = `translate(${x}px, ${y}px)`
    }
    for (const [id, el] of live) {
      if (!seen.has(id)) { el.remove(); live.delete(id) }
    }
  })

  return {
    hover(id) {
      if (id === hovered) return
      live.get(hovered)?.classList.remove('is-hover')
      hovered = id
      live.get(id)?.classList.add('is-hover')
    },
  }
}

/** One cluster's element: see `clusterRings`. */
function clusterRing(p, palette) {
  const n = p.point_count
  const d = n < 10 ? CLUSTER_SIZE[0] : n < 50 ? CLUSTER_SIZE[1] : CLUSTER_SIZE[2]
  let parts = palette.map((color, i) => [color, p[`c${i}`] ?? 0]).filter(([, k]) => k > 0).sort((a, b) => b[1] - a[1])
  if (parts.length > RING_COLOURS + 1) {
    const rest = parts.slice(RING_COLOURS).reduce((sum, [, k]) => sum + k, 0)
    parts = [...parts.slice(0, RING_COLOURS), [readColor('--faint'), rest]]
  }

  // A 2.5px ring, 3px inside the rim, its segments rounded and 5px apart —
  // less where many share a small ring, and square-ended where that leaves no
  // room for the rounded ends.
  const width = 2.5, r = d / 2 - 3 - width / 2, C = 2 * Math.PI * r, mid = d / 2
  const gap = parts.length > 1 ? Math.min(5, C / parts.length / 2) : 0
  const round = gap >= width + 1.5
  let offset = 0, arcs = ''
  for (const [color, k] of parts) {
    const len = C * k / n
    const dash = round ? Math.max(len - gap, .01) : Math.max(len - Math.max(gap - width, 1), .5)
    arcs += `<circle r="${r}" cx="${mid}" cy="${mid}" stroke="${color}" stroke-width="${width}"`
      + ` stroke-linecap="${round ? 'round' : 'butt'}" stroke-dasharray="${dash} ${C}"`
      + ` stroke-dashoffset="${-offset}" transform="rotate(-90 ${mid} ${mid})"/>`
    offset += len
  }

  const el = document.createElement('div')
  el.className = 'mk'
  el.innerHTML = `<div class="mk__in" style="width:${d}px;height:${d}px">`
    + `<svg width="${d}" height="${d}" fill="none">${arcs}</svg><b>${p.point_count_abbreviated}</b></div>`
  return el
}

/**
 * The padding a page's small map frames its points with: room for the zoom
 * control on the right and the attribution button at the bottom, never more
 * than a fifth of the map's height or width. On a phone the crag's map is
 * about 270 by 170 pixels, and the fixed 60/80/70/50 the wide map uses left
 * 40 pixels in the middle, too little to fit the walk at a useful zoom.
 */
export function smallMapPadding(container) {
  const { width, height } = container.getBoundingClientRect()
  const v = Math.min(70, Math.round(height * 0.2))
  const h = Math.min(80, Math.round(width * 0.2))
  return { top: Math.min(60, v), right: h, bottom: v, left: Math.min(50, h) }
}

/**
 * Keeps MapLibre's attribution folded into its ⓘ button. On a narrow map
 * MapLibre opens it on its own — when the map first takes its size, after the
 * style has named its sources — and folds it only once the map is dragged: on
 * a phone the crag's map showed the credits over its lower half, the parking
 * and most of the walk under them. Folded, the credits are one tap away, as
 * MapLibre itself leaves them on every narrow map once it has been moved.
 * Whoever taps the button decides from then on; nothing folds it after that.
 */
export function foldAttribution(map) {
  const container = map.getContainer()
  let touched = false
  container.addEventListener('click', e => {
    if (e.target.closest('.maplibregl-ctrl-attrib-button')) touched = true
  })
  const fold = () => {
    const attrib = container.querySelector('.maplibregl-ctrl-attrib.maplibregl-compact-show')
    if (touched || !attrib) return
    attrib.classList.remove('maplibregl-compact-show')
    attrib.removeAttribute('open')
  }
  // Registered after the attribution control's own listeners, so these run
  // after it has opened itself.
  map.on('resize', fold)
  map.on('styledata', fold)
  map.on('load', fold)
}

/**
 * Fits the view to `features`' own bounding box, with padding — or a fixed
 * Italy-wide view when there is nothing to fit to. The same fallback home's
 * map has always used, now shared with Find, whose "no results" case is
 * exactly as real as home's "nothing has coordinates yet" case. `duration`
 * glides there instead of jumping, for a map that stays on screen while its
 * pins change.
 */
export function fitToFeatures(map, features, opts = {}) {
  const {
    padding = 40, maxZoom = 12,
    fallbackCenter = [12.5, 42], fallbackZoom = 5,
    duration = 0,
  } = opts

  if (features.length === 0) {
    map.jumpTo({ center: fallbackCenter, zoom: fallbackZoom })
    return
  }

  const lons = features.map(f => f.geometry.coordinates[0])
  const lats = features.map(f => f.geometry.coordinates[1])
  // where the question card and the sheet lie over the map, fit the pins
  // into the band left between them rather than under them
  // (the band is short on a phone, so the margin round the pins shrinks there)
  const ins = typeof padding === 'number' ? seenInsets(map) : null
  const covered = ins && (ins.top > 0 || ins.bottom > 0)
  const p = covered ? Math.min(padding, 22) : padding
  const pad = covered && map.getContainer().clientHeight - ins.top - ins.bottom > 2 * p + 40
    ? { top: p + ins.top, bottom: p + ins.bottom, left: p, right: p }
    : padding
  map.fitBounds(
    [[Math.min(...lons), Math.min(...lats)], [Math.max(...lons), Math.max(...lats)]],
    { padding: pad, maxZoom, duration },
  )
}

/**
 * How much of the map, in pixels from its top and its bottom, the page holds
 * over it: on a phone, Find's question card above and the list's sheet below
 * (find-sheet.js). Zero on a wide screen, where both sit beside the map, and on
 * every page that has neither.
 */
export function seenInsets(map) {
  const m = map.getContainer().getBoundingClientRect()
  const over = el => {
    const r = el?.getBoundingClientRect()
    return r && r.height > 0 && r.left < m.right && r.right > m.left && r.top < m.bottom && r.bottom > m.top ? r : null
  }
  let top = 0, bottom = 0
  const q = over(document.querySelector('.split>.col>.q'))
  if (q && q.top <= m.top + m.height / 3) top = Math.max(0, q.bottom - m.top)
  const sheet = over(document.querySelector('.split>.col>.list'))
  if (sheet && sheet.top > m.top) bottom = Math.max(0, m.bottom - sheet.top)
  return { top, bottom }
}

/**
 * Keeps a page's map standing while find-live.js swaps the page around it
 * (home to Find, one search to the next). Each swap sends the new page's pins
 * in a `find:pins` event; the map changes its points and glides to them,
 * rather than being built again. A search that found nothing leaves the view
 * where it was: the visitor is still looking at the same place, and a jump to
 * all of Italy says nothing. Call after the map's own `load` handler is set.
 */
export function followPins(map, sourceId, colorOf) {
  let loaded = false
  let waiting = null

  const show = pins => {
    map.fire('pins:replaced')
    const located = pins.filter(p => typeof p.lat === 'number' && typeof p.lon === 'number')
    legend(map, located, colorOf)
    const features = toFeatures(located, colorOf)
    ensureDrops(map, features.map(f => f.properties.color))
    map.getSource(sourceId).setData({ type: 'FeatureCollection', features })
    if (features.length > 0) fitToFeatures(map, features, { duration: 700 })
  }

  map.on('load', () => {
    loaded = true
    if (waiting) show(waiting)
  })
  document.addEventListener('find:pins', e => {
    if (loaded) show(e.detail)
    else waiting = e.detail
  })
}

/**
 * Each pin in its activity's colour, `--act-<id>` in app.css — or
 * `--faint` for an activity the stylesheet has no colour for yet, so a new
 * registry file shows up on the map before anyone has picked its colour.
 */
export function activityColor() {
  const faint = readColor('--faint')
  const known = new Map()
  return p => {
    if (!known.has(p.activity)) known.set(p.activity, (p.activity && readColor(`--act-${p.activity}`)) || faint)
    return known.get(p.activity)
  }
}

/**
 * The map's key: one drop and its activity's name for each activity among the
 * pins, since a colour never carries meaning on its own on this site. Redrawn
 * whenever the pins change, so a search for crags shows only Falesia.
 *
 * A key that would run past three lines folds into a pill, the first drops and
 * how many activities there are, which opens the whole key above it on a tap:
 * with all nineteen on a phone the open key took a third of the map and hid
 * its pins. Whether it fits is measured, not counted, so a wide map keeps
 * more of it open than a narrow one, and it is measured again on resize.
 */
export function legend(map, pins, colorOf) {
  const container = map.getContainer()
  container.querySelector('.map__leg')?.remove()
  const seen = new Map()
  for (const p of pins) {
    if (!p.activity || seen.has(p.activity)) continue
    seen.set(p.activity, { label: p.recap?.kind ?? p.activity, color: colorOf(p) })
  }
  if (seen.size === 0) return
  const entries = [...seen.values()].sort((a, b) => a.label.localeCompare(b.label, 'it'))

  const box = document.createElement('div')
  box.className = 'map__leg'
  box.lang = 'it'
  const list = document.createElement('div')
  list.className = 'map__leg-list'
  list.id = `map-leg-${++legendCount}`
  entries.forEach(({ label, color }) => {
    const item = document.createElement('span')
    item.append(drop(color), label)
    list.append(item)
  })
  const button = document.createElement('button')
  button.type = 'button'
  button.className = 'map__leg-btn'
  button.setAttribute('aria-controls', list.id)
  button.setAttribute('aria-expanded', 'false')
  const drops = document.createElement('span')
  drops.className = 'map__leg-drops'
  for (const { color } of entries.slice(0, 4)) drops.append(drop(color))
  button.append(drops, `${entries.length} attività`)
  button.addEventListener('click', () => setOpen(box, !box.classList.contains('is-open')))
  box.append(list, button)
  container.append(box)
  fitLegend(box)

  if (!container.dataset.legendWired) {
    container.dataset.legendWired = '1'
    map.on('resize', () => {
      const current = container.querySelector('.map__leg')
      if (current) fitLegend(current)
    })
    map.on('click', () => {
      const current = container.querySelector('.map__leg')
      if (current) setOpen(current, false)
    })
    container.addEventListener('keydown', e => {
      const current = container.querySelector('.map__leg.is-open')
      if (e.key === 'Escape' && current) {
        setOpen(current, false)
        current.querySelector('.map__leg-btn').focus()
      }
    })
  }
}

let legendCount = 0

/** Folds the key when its entries, laid out in one block, run past three lines. */
function fitLegend(box) {
  const wasOpen = box.classList.contains('is-open')
  box.classList.remove('is-folded', 'is-open')
  const lines = new Set([...box.querySelectorAll('.map__leg-list > span')].map(s => s.offsetTop))
  if (lines.size > 3) {
    // The open panel never reaches past the zoom control at the map's top.
    box.style.setProperty('--leg-room', `${box.parentElement.clientHeight - 140}px`)
    box.classList.add('is-folded')
    if (wasOpen) box.classList.add('is-open')
  }
}

function setOpen(box, open) {
  if (!box.classList.contains('is-folded')) return
  box.classList.toggle('is-open', open)
  box.querySelector('.map__leg-btn').setAttribute('aria-expanded', String(open))
}

function drop(color) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg', 'svg')
  svg.setAttribute('viewBox', '0 0 24 32')
  svg.setAttribute('width', '11')
  svg.setAttribute('height', '15')
  svg.setAttribute('aria-hidden', 'true')
  const path = document.createElementNS('http://www.w3.org/2000/svg', 'path')
  path.setAttribute('d', DROP)
  path.setAttribute('fill', color)
  svg.append(path)
  return svg
}

/** The drop's outline, in a 24 × 32 box whose bottom centre is the point on the ground. */
const DROP = 'M12 31C12 31 2 18.6 2 11.5a10 10 0 0 1 20 0C22 18.6 12 31 12 31Z'

/**
 * Draws one drop in `color` and adds it to the map as `drop:<color>`: the
 * fill, a white rim and a white eye, with a faint shadow under it so a pin
 * reads on pale ground. Drawn at twice the size for sharp edges on any screen.
 */
function addDrop(map, color) {
  const id = `drop:${color}`
  if (map.hasImage(id)) return
  const ratio = 2
  const canvas = document.createElement('canvas')
  canvas.width = 24 * ratio
  canvas.height = 34 * ratio
  const ctx = canvas.getContext('2d')
  ctx.scale(ratio, ratio)
  const drop = new Path2D(DROP)
  ctx.save()
  ctx.shadowColor = 'rgba(27, 39, 51, .35)'
  ctx.shadowBlur = 2
  ctx.shadowOffsetY = 1
  ctx.fillStyle = color
  ctx.fill(drop)
  ctx.restore()
  ctx.lineWidth = 1.5
  ctx.strokeStyle = '#FFFFFF'
  ctx.stroke(drop)
  ctx.beginPath()
  ctx.arc(12, 11.5, 3.6, 0, Math.PI * 2)
  ctx.fillStyle = '#FFFFFF'
  ctx.fill()
  map.addImage(id, ctx.getImageData(0, 0, canvas.width, canvas.height), { pixelRatio: ratio })
}

function ensureDrops(map, colors) {
  for (const c of new Set(colors)) addDrop(map, c)
}

/** How far above the point the card's tip sits: the chosen drop's height, and a gap. */
const CARD_LIFT = 32 * 1.2 + 6

/**
 * The card a clicked pin opens over itself: what the route is, where, its
 * first facts and, on Find, its conditions — then a link to the route. The
 * card is a real link, so it opens the route the way any link does (and the
 * page's own transition plays); a second click on the same pin does the same.
 * Anything else — the map, a cluster, a new set of pins, a zoom — closes it.
 * Every string goes in as text, never as markup: route names are typed by
 * contributors.
 */
function pinCard(map, sourceId) {
  const container = map.getContainer()
  const chosen = `${sourceId}-chosen`
  const calm = matchMedia('(prefers-reduced-motion: reduce)')
  let open = null

  const el = (tag, cls, text) => {
    const e = document.createElement(tag)
    if (cls) e.className = cls
    if (text !== undefined) e.textContent = text
    return e
  }

  const place = () => {
    if (!open) return
    const p = map.project(open.at)
    open.el.style.transform = `translate(${Math.round(p.x)}px, ${Math.round(p.y - CARD_LIFT)}px) translate(-50%, -100%)`
  }

  const build = f => {
    const recap = JSON.parse(f.properties.recap || 'null')
    const a = el('a', 'pc')
    a.href = `/itinerario/${encodeURIComponent(f.properties.id)}`
    const body = el('div', 'pc__in')
    a.append(body)
    if (recap) body.append(el('p', 'pc__k', recap.kind))
    body.append(el('p', 'pc__n', f.properties.name))
    if (recap?.where) body.append(el('p', 'pc__w', recap.where))
    if (recap?.facts.length) {
      const dl = el('dl', 'pc__f')
      for (const fact of recap.facts) {
        const d = el('div')
        d.append(el('dt', '', fact.label), el('dd', '', fact.text))
        dl.append(d)
      }
      body.append(dl)
    }
    if (recap?.state) {
      // How many reports and when, as the Find row beside it says it. A tint
      // is only ever applied if one is given, and none is any more.
      const s = el('p', 'pc__c')
      const b = el('b', '', recap.state.label)
      if (recap.state.tint) b.style.color = `var(--${recap.state.tint})`
      s.append(b, el('span', '', recap.state.said))
      body.append(s)
    }
    const go = el('p', 'pc__go')
    go.append(el('span', '', 'Apri l’itinerario'), el('span', '', '→'))
    body.append(go)
    return a
  }

  const close = () => {
    if (!open) return
    const { el: gone } = open
    open = null
    map.setFilter(chosen, ['==', ['get', 'id'], ''])
    if (calm.matches) gone.remove()
    else {
      gone.classList.add('is-leaving')
      setTimeout(() => gone.remove(), 160)
    }
  }

  const reveal = () => {
    if (!open) return
    const box = open.el.getBoundingClientRect()
    const frame = container.getBoundingClientRect()
    const margin = 12
    const dx = Math.min(0, frame.right - margin - box.right) || Math.max(0, frame.left + margin - box.left)
    const dy = Math.max(0, frame.top + margin - box.top)
    if (dx || dy) map.panBy([-dx, -dy], { duration: calm.matches ? 0 : 300 })
  }

  return {
    open(f) {
      if (open?.id === f.properties.id) {
        window.location.href = open.el.href
        return
      }
      close()
      open = { id: f.properties.id, at: f.geometry.coordinates, el: build(f) }
      map.setFilter(chosen, ['==', ['get', 'id'], f.properties.id])
      container.append(open.el)
      place()
      reveal()
    },
    close,
    place,
  }
}
