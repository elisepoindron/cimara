import { test } from 'node:test'
import assert from 'node:assert/strict'
import { parseHTML } from 'linkedom'
import { running } from '../helpers/http.ts'
import { insertPlace } from '../../src/db/place.ts'
import { insertItinerary, insertPart } from '../../src/db/itinerary.ts'
import type { FetchTrail } from '../../src/app/trail.ts'

const dom = (m: string) => parseHTML(m).document
const mapData = async (base: string, id: string) =>
  JSON.parse(dom(await (await fetch(`${base}/itinerario/${id}`)).text()).querySelector('#map-data')!.textContent!)

test('a crag page asks for its walk once, then draws it on the next view', async () => {
  const asked: string[] = []
  const fetchTrail: FetchTrail = async (from, to) => {
    asked.push(`${from.lat},${from.lon}->${to.lat},${to.lon}`)
    return { coords: [[from.lon, from.lat], [to.lon, from.lat], [to.lon, to.lat]], lengthM: 620, ascentM: 80 }
  }
  const s = await running(null, null, null, fetchTrail)
  try {
    await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
    await insertItinerary(s.db, {
      id: 'balma', activity: 'falesia', placeId: 'p1', name: 'Balma Scura',
      lat: 45.06, lon: 7.15, parkingLat: 45.0587, parkingLon: 7.1443, aspect: 'S', altMax: 780,
      facts: { esposizione: 'S', quota_base: 780, avvicinamento: 20, riparato_dal_vento: false },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })
    await insertPart(s.db, { id: 'v1', itineraryId: 'balma', group: 'Basso', position: 1,
      fields: { nome: 'Via di prova', grado: '6a', lunghezza: 25 } })

    const first = await mapData(s.base, 'balma')
    assert.equal('trail' in first, false, 'a cold cache draws the straight line')
    await new Promise(r => setTimeout(r, 10))

    const second = await mapData(s.base, 'balma')
    assert.equal(second.trail.coords.length, 3)
    assert.deepEqual(asked, ['45.0587,7.1443->45.06,7.15'], 'asked once, parking to crag')
  } finally {
    s.server.close()
  }
})

test('an alpine route never asks for a walk: its second point is a summit', async () => {
  let calls = 0
  const s = await running(null, null, null, async () => { calls++; return null })
  try {
    await insertPlace(s.db, { id: 'p1', name: 'Piemonte', kind: 'regione', parentId: null })
    await insertItinerary(s.db, {
      id: 'cresta', activity: 'alpinismo', placeId: 'p1', name: 'Cresta',
      lat: 44.6673, lon: 7.0913, parkingLat: 44.69938, parkingLon: 7.15609, aspect: 'E', altMax: 3841,
      facts: { difficolta: 'AD', dislivello: 900, partenza: 2100, vetta: 3000, esposizione: 'SE', giorni: 1 },
      sections: {}, created: '2026-09-01T00:00:00.000Z',
    })
    await fetch(`${s.base}/itinerario/cresta`)
    assert.equal(calls, 0)
  } finally {
    s.server.close()
  }
})
