// The home page's map: a sample of the whole archive, ungraded. See
// the home map's design spec and
// the map-everywhere design spec.
//
// When a search is typed here, find-live.js swaps Find in around this map, and
// the map stays: it takes the results' pins. Every pin, here and on Find, is
// in its activity's colour.
import * as maplibregl from '/vendor/maplibre-gl.mjs'
import {
  addClusteredLayer, fitToFeatures, readLocatedPins, toFeatures, createMap, followPins, activityColor, legend,
} from './map-core.js'
import { listFollowsMap } from './list-in-view.js'

const colorOf = activityColor()
const pins = readLocatedPins()
const features = toFeatures(pins, colorOf)

const map = createMap(maplibregl)

map.on('load', () => {
  addClusteredLayer(map, 'routes', features)
  fitToFeatures(map, features)
})
legend(map, pins, colorOf)
followPins(map, 'routes', colorOf)
// A search typed here turns the page into Find around this same map, so the
// list it brings has to follow the map too; on the home itself it asks nothing.
listFollowsMap(map, colorOf)
