import { test } from 'node:test'
import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { freshDb } from '../helpers/db.ts'
import { memoryPhotoStore } from '../helpers/photo-store.ts'
import { seed } from '../../src/seed/seed.ts'
import { allItineraries } from '../../src/db/itinerary.ts'
import { giteFor } from '../../src/db/gita.ts'
import { photosFor, standingPhoto } from '../../src/db/gita-photo.ts'

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0x10, 0x4a, 0x46, 0x49, 0x46, 0xff, 0xd9])

const CREDIT = {
  author: 'Mario Rossi', licence: 'CC BY-SA 4.0',
  licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
  url: 'https://commons.wikimedia.org/wiki/File:Placca.jpg',
}

type Photo = { file: string; caption?: string }

/** A seed folder of one hike with two reports, and a photos folder beside it. */
async function folder(photos: Photo[], credits: Record<string, unknown> = { 'placca.jpg': CREDIT },
                      files: string[] = ['placca.jpg']) {
  const root = await mkdtemp(join(tmpdir(), 'app-seed-'))
  const data = join(root, 'data'), dir = join(root, 'photos')
  await mkdir(data); await mkdir(dir)
  await writeFile(join(data, 'one.json'), JSON.stringify({
    places: [{ key: 'p', name: 'Piemonte', kind: 'regione' }],
    itineraries: [{
      key: 'r', activity: 'escursionismo', place: 'p', name: 'Rocca di prova', lat: 45.1, lon: 7.3,
      facts: { difficolta: 'E', dislivello: 500, partenza: 400, vetta: 900 },
      reports: [
        { observedAt: '2026-05-12', words: 'Sentiero asciutto.', photos },
        { observedAt: '2026-04-01', words: 'Nebbia in cima.' },
      ],
    }],
  }))
  await writeFile(join(dir, 'credits.json'), JSON.stringify(credits))
  for (const f of files) await writeFile(join(dir, f), JPEG)
  return { root, data, dir }
}

async function routeId(db: Awaited<ReturnType<typeof freshDb>>) {
  return (await allItineraries(db)).find(i => i.name === 'Rocca di prova')!.id
}

test("an imported report's photos are held against it, credited, with their bytes in the store", async () => {
  const f = await folder([{ file: 'placca.jpg', caption: 'La placca' }])
  try {
    const db = await freshDb(), store = memoryPhotoStore()
    const counts = await seed(db, f.data, { photos: store, photosDir: f.dir })
    assert.equal(counts.photos, 1)

    const id = await routeId(db)
    const [photo] = await photosFor(db, id)
    const report = (await giteFor(db, id)).find(g => g.observedAt === '2026-05-12')!
    assert.equal(photo?.gitaId, report.id, 'the photo hangs off its own report')
    assert.equal(photo?.authorName, null, 'nobody here filed the report')
    assert.equal(photo?.caption, 'La placca')
    assert.deepEqual(photo?.credit, {
      author: 'Mario Rossi', licence: 'CC BY-SA 4.0',
      licenceUrl: 'https://creativecommons.org/licenses/by-sa/4.0',
      source: 'https://commons.wikimedia.org/wiki/File:Placca.jpg',
    })
    assert.deepEqual(await store.get(photo!.id, 'image/jpeg'), JPEG)
    assert.equal(await standingPhoto(db, photo!.id), true, 'an imported photo is served like a filed one')
  } finally { await rm(f.root, { recursive: true }) }
})

test('seeding twice adds no photo twice, and puts back bytes a store lost', async () => {
  const f = await folder([{ file: 'placca.jpg' }])
  try {
    const db = await freshDb()
    await seed(db, f.data, { photos: memoryPhotoStore(), photosDir: f.dir })
    const emptied = memoryPhotoStore()
    const again = await seed(db, f.data, { photos: emptied, photosDir: f.dir })
    assert.equal(again.photos, 0)

    const photos = await photosFor(db, await routeId(db))
    assert.equal(photos.length, 1)
    assert.ok(await emptied.get(photos[0]!.id, 'image/jpeg'), 'the bytes are written again')
  } finally { await rm(f.root, { recursive: true }) }
})

test('a report seeded before photos existed gets them on the next run', async () => {
  const f = await folder([{ file: 'placca.jpg' }])
  try {
    const db = await freshDb()
    await seed(db, f.data)                       // no store: no photos
    assert.equal((await photosFor(db, await routeId(db))).length, 0)
    const later = await seed(db, f.data, { photos: memoryPhotoStore(), photosDir: f.dir })
    assert.equal(later.reports, 0)
    assert.equal(later.photos, 1)
  } finally { await rm(f.root, { recursive: true }) }
})

test('a photo whose licence names no author is refused by name, and nothing is written', async () => {
  const f = await folder([{ file: 'placca.jpg' }], { 'placca.jpg': { ...CREDIT, author: '' } })
  try {
    const db = await freshDb()
    await assert.rejects(seed(db, f.data, { photos: memoryPhotoStore(), photosDir: f.dir }),
      /Rocca di prova, report of 2026-05-12, photos\[1\]\.file: expected an author, a licence and a url.*placca\.jpg/)
    assert.equal((await allItineraries(db)).length, 0, 'the seed is one transaction')
  } finally { await rm(f.root, { recursive: true }) }
})

test('a photo with no credit entry at all is refused by name', async () => {
  const f = await folder([{ file: 'placca.jpg' }], {})
  try {
    await assert.rejects(seed(await freshDb(), f.data, { photos: memoryPhotoStore(), photosDir: f.dir }),
      /photos\[1\]\.file: expected an author/)
  } finally { await rm(f.root, { recursive: true }) }
})

test('a photo whose file is not there is refused by name', async () => {
  const f = await folder([{ file: 'placca.jpg' }], undefined, [])
  try {
    await assert.rejects(seed(await freshDb(), f.data, { photos: memoryPhotoStore(), photosDir: f.dir }),
      /photos\[1\]\.file: no such file .*placca\.jpg/)
  } finally { await rm(f.root, { recursive: true }) }
})

test('a file that is not a jpeg or a png is refused by name', async () => {
  const f = await folder([{ file: 'placca.gif' }], { 'placca.gif': CREDIT }, ['placca.gif'])
  try {
    await assert.rejects(seed(await freshDb(), f.data, { photos: memoryPhotoStore(), photosDir: f.dir }),
      /photos\[1\]\.file: expected a \.jpg or \.png file/)
  } finally { await rm(f.root, { recursive: true }) }
})

test('more than six photos to a report are refused, as a gita would be', async () => {
  const seven = Array.from({ length: 7 }, () => ({ file: 'placca.jpg' }))
  const f = await folder(seven)
  try {
    await assert.rejects(seed(await freshDb(), f.data, { photos: memoryPhotoStore(), photosDir: f.dir }),
      /photos: at most 6 photos to a report \(found: 7\)/)
  } finally { await rm(f.root, { recursive: true }) }
})
