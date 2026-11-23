import { test } from 'node:test'
import assert from 'node:assert/strict'
import { freshDb } from '../helpers/db.ts'
import { insertWeatherStation, stationsNear } from '../../src/db/weather-station.ts'

const CAROGNE = { lat: 45.64777, lon: 7.71841 }
const station = (code: string, name: string, altM: number, lat: number, lon: number) =>
  ({ network: 'cf-vda', code, name, altM, lat, lon })

test('the stations near a point come nearest first, within the radius and the limit', async () => {
  const db = await freshDb()
  await insertWeatherStation(db, station('1760', 'Hône - Ayasse', 367, 45.6117, 7.73277))
  await insertWeatherStation(db, station('3000', 'Verrès-Capoluogo', 375, 45.6651, 7.6861))
  await insertWeatherStation(db, station('1310', 'Hône-Dora', 340, 45.6172, 7.73993))
  await insertWeatherStation(db, station('4020', 'Aosta-Mont-Fleury', 577, 45.7305, 7.29903))

  const near = await stationsNear(db, CAROGNE, 10_000, 2)
  assert.deepEqual(near.map(s => s.code), ['3000', '1310'])
  assert.ok(near[0]!.distanceM < near[1]!.distanceM)
  assert.equal(near[0]!.altM, 375)

  const all = await stationsNear(db, CAROGNE, 10_000, 10)
  assert.deepEqual(all.map(s => s.code), ['3000', '1310', '1760'], 'Aosta, 34 km off, is not near')
})

test('seeding a known station again leaves it as it was', async () => {
  const db = await freshDb()
  assert.equal(await insertWeatherStation(db, station('1760', 'Hône - Ayasse', 367, 45.6117, 7.73277)), true)
  assert.equal(await insertWeatherStation(db, station('1760', 'Altro nome', 999, 45.6117, 7.73277)), false)
  const [only] = await stationsNear(db, CAROGNE, 10_000, 5)
  assert.equal(only!.name, 'Hône - Ayasse')
})

test('nowhere near a station, the list is empty', async () => {
  const db = await freshDb()
  await insertWeatherStation(db, station('1760', 'Hône - Ayasse', 367, 45.6117, 7.73277))
  assert.deepEqual(await stationsNear(db, { lat: 44.28, lon: 7.44 }, 10_000, 3), [])
})
