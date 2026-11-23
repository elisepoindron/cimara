import { test } from 'node:test'
import assert from 'node:assert/strict'
import { osmItineraryId } from '../../src/import/osm/stable-id.ts'

test('an OpenStreetMap id always gives the same itinerary id, shaped as a UUID', () => {
  const id = osmItineraryId('w1096333248')
  assert.equal(osmItineraryId('w1096333248'), id)
  assert.match(id, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
})

test('two OpenStreetMap ids never share an itinerary id, nor do a node and a way of the same number', () => {
  const ids = ['n1', 'w1', 'r1', 'n2', 'w1096333248', 'r162371'].map(osmItineraryId)
  assert.equal(new Set(ids).size, ids.length)
})
