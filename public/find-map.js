// Find's map: fits to whatever the current search actually returned, each
// point in its activity's colour, with its conditions on its card. See
// the map-everywhere design spec.
// Made once; later searches swapped in by find-live.js reach it as pins.
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
listFollowsMap(map, colorOf)
