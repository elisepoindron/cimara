import { test } from 'node:test'
import assert from 'node:assert/strict'
import { heightAgainst, stationPage } from '../../src/domain/stations.ts'

test('an Aosta station links to its own page by the network\'s code', () => {
  assert.equal(stationPage({ network: 'cf-vda', code: '1760' }),
    'https://presidi2.regione.vda.it/str_dataview_station/1760')
})

test('a station of a network the registry does not know has no page', () => {
  assert.equal(stationPage({ network: 'altrove', code: '1' }), null)
})

test('a station is said against the route\'s own height', () => {
  assert.equal(heightAgainst(375, 500), '125 m più in basso')
  assert.equal(heightAgainst(662, 500), '162 m più in alto')
  assert.equal(heightAgainst(510, 500), 'alla stessa quota')
})

test('without the route\'s height there is nothing to say it against', () => {
  assert.equal(heightAgainst(375, null), null)
})
