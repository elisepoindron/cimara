import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running } from '../helpers/http.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary } from '../../src/db/itinerary.ts'
import { saveWeatherCache } from '../../src/db/weather.ts'
import { insertWeatherStation } from '../../src/db/weather-station.ts'
import type { FetchWeather } from '../../src/app/weather.ts'
import { STRIP_DAYS } from '../../src/domain/weather.ts'

const dom = (m: string) => parseHTML(m).document
const fetchWeather: FetchWeather = async () => ({ tempC: 12, daysSinceRain: 3, days: null })

test('an itinerary with coordinates carries the weather strip; one without does not', async () => {
  const s = await running(null, fetchWeather)
  try {
    await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
    await insertItinerary(s.db, {
      id: 'with-coords', activity: 'alpinismo', placeId: 'p1', name: 'Con coordinate',
      lat: 44.6, lon: 7.1, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
      facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
               esposizione: 'SE', giorni: 1 },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })
    await insertItinerary(s.db, {
      id: 'without-coords', activity: 'alpinismo', placeId: 'p1', name: 'Senza coordinate',
      lat: null, lon: null, parkingLat: null, parkingLon: null, aspect: 'SE', altMax: 3000,
      facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000,
               esposizione: 'SE', giorni: 1 },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })

    // weatherFor answers from cache, never blocking a request on the live
    // call — a truly cold cache (nothing seeded) returns null for this very
    // request and only refetches in the background, so the strip would be
    // absent on the first hit regardless of coordinates. Seeding a fresh row
    // at the rounded coordinates is what makes "strip present" the thing
    // this test actually proves, rather than an artifact of request timing.
    const days = Array.from({ length: STRIP_DAYS }, (_, i) => ({
      date: `2026-09-${String(8 + i).padStart(2, '0')}`,
      when: (i < 7 ? 'past' : i === 7 ? 'today' : 'forecast') as 'past' | 'today' | 'forecast',
      sky: 'sereno' as const, rainMm: 0,
    }))
    // At the route's start, 2100 m: the altitude its weather is asked for.
    await saveWeatherCache(s.db, 44.6, 7.1, 2100, { tempC: 12, daysSinceRain: 3, days, fetchedAt: new Date().toISOString() })

    const withCoords = dom(await (await fetch(s.base + '/itinerario/with-coords')).text())
    assert.equal(withCoords.querySelectorAll('#condizioni .wxs').length, 1)
    assert.equal(withCoords.querySelectorAll('#meteo').length, 0)

    const withoutCoords = dom(await (await fetch(s.base + '/itinerario/without-coords')).text())
    assert.equal(withoutCoords.querySelectorAll('.wxs').length, 0)
  } finally { s.server.close() }
})

test('GET /route-weather.js no longer exists', async () => {
  const s = await running()
  try {
    const res = await fetch(s.base + '/route-weather.js')
    assert.equal(res.status, 404)
  } finally { s.server.close() }
})

test('a route near a weather station lists it under Adesso, said against the route\'s own height', async () => {
  const s = await running(null, fetchWeather)
  try {
    await insertPlace(s.db, { id: 'p1', name: 'Valle d\'Aosta', kind: 'regione', parentId: null })
    await insertItinerary(s.db, {
      id: 'carogne', activity: 'alpinismo', placeId: 'p1', name: 'Sopra Arnad',
      lat: 45.64777, lon: 7.71841, parkingLat: null, parkingLon: null, aspect: 'S', altMax: 1500,
      facts: { difficolta: 'PD', dislivello: 1000, partenza: 500, vetta: 1500,
               esposizione: 'S', giorni: 1 },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })
    await insertWeatherStation(s.db, { network: 'cf-vda', code: '3000', name: 'Verrès-Capoluogo',
      altM: 375, lat: 45.6651, lon: 7.6861 })

    const page = dom(await (await fetch(s.base + '/itinerario/carogne')).text())
    assert.equal(page.querySelectorAll('#condizioni details.stz').length, 1)
    assert.equal(page.querySelector('.stz .near a')?.getAttribute('href'),
      'https://presidi2.regione.vda.it/str_dataview_station/3000')
    assert.equal(page.querySelector('.stz .near__d')?.textContent, '125 m più in basso')
    assert.equal(page.querySelectorAll('script[src^="/station-fold.js"]').length, 1)
    assert.equal((await fetch(s.base + '/station-fold.js')).status, 200)
  } finally { s.server.close() }
})
