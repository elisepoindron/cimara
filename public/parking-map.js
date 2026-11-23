// An alpine route's parking spot and — where the route has its own
// coordinates too — its summit, as the P square and the triangle the rows
// above the map use, cloned from those rows so the rows are the legend. The
// view fits to hold both. No line between them: the approach is prose, not a
// time. Around them, every other route of the same activity nearby
// (`around`), as drops in the activity's colour that open the same card as on
// Find; the view stays on the parking and the summit. See
// the map-everywhere design spec.
import * as maplibregl from '/vendor/maplibre-gl.mjs'
import {
  STYLE, fitToFeatures, shapeFromRow, addClusteredLayer, toFeatures, activityColor,
  smallMapPadding, foldAttribution, withGround,
} from './map-core.js'

const { lat, lon, itineraryLat, itineraryLon, around = [] } =
  JSON.parse(document.getElementById('map-data').textContent)
const hasItinerary = typeof itineraryLat === 'number' && typeof itineraryLon === 'number'

const map = new maplibregl.Map({
  container: 'map',
  style: STYLE,
  center: [lon, lat],
  zoom: 15,
})
withGround(map)

map.addControl(new maplibregl.NavigationControl(), 'top-right')
foldAttribution(map)

function addShape(kind, plon, plat) {
  const element = shapeFromRow(kind)
  if (element) new maplibregl.Marker({ element }).setLngLat([plon, plat]).addTo(map)
}

map.on('load', () => {
  if (around.length) addClusteredLayer(map, 'near', toFeatures(around, activityColor()))
  addShape('p', lon, lat)
  if (!hasItinerary) return

  addShape('v', itineraryLon, itineraryLat)

  const point = (plon, plat) =>
    ({ type: 'Feature', properties: {}, geometry: { type: 'Point', coordinates: [plon, plat] } })
  // Wider on the right and bottom, where MapLibre's zoom control and
  // attribution sit, as on the crag's map.
  fitToFeatures(map, [point(lon, lat), point(itineraryLon, itineraryLat)],
    { maxZoom: 15, padding: smallMapPadding(map.getContainer()) })
})
