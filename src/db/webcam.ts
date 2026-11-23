import type { Db } from './open.ts'
import { boundingBox, distanceM, type Point } from '../domain/geo.ts'

export interface WebcamReading {
  readonly name: string
  readonly snowAboveM: number | null
  readonly takenAt: string          // ISO-8601
  readonly distanceM: number
}

/** A webcam identified by its natural key — name — as the seed matches on. */
export async function findWebcamByName(db: Db, name: string): Promise<{ id: string } | undefined> {
  return db.get<{ id: string }>('select id from webcam where name = ?', [name])
}

export interface NewWebcam {
  readonly id: string
  readonly name: string
  readonly lat: number
  readonly lon: number
}

export async function insertWebcam(db: Db, cam: NewWebcam): Promise<void> {
  await db.run('insert into webcam (id, name, lat, lon) values (?, ?, ?, ?)',
    [cam.id, cam.name, cam.lat, cam.lon])
}

export interface NewWebcamReading {
  readonly id: string
  readonly webcamId: string
  readonly takenAt: string
  readonly snowAboveM: number
}

export async function insertWebcamReading(db: Db, reading: NewWebcamReading): Promise<void> {
  await db.run(`insert into webcam_reading (id, webcam_id, taken_at, snow_above_m)
                values (?, ?, ?, ?)`,
    [reading.id, reading.webcamId, reading.takenAt, reading.snowAboveM])
}

/** The latest reading of each camera near a point, nearest camera first. */
export async function readingsNear(db: Db, of: Point, withinM: number): Promise<WebcamReading[]> {
  const box = boundingBox(of, withinM)

  const rows = await db.all<{ name: string; lat: number; lon: number
                              snow_above_m: number | null; taken_at: string }>(`
    select w.name, w.lat, w.lon, latest.snow_above_m, latest.taken_at
    from webcam w
    join webcam_reading latest on latest.id = (
      select r.id from webcam_reading r
      where r.webcam_id = w.id
      order by r.taken_at desc limit 1
    )
    where w.lat between ? and ? and w.lon between ? and ?
  `, [box.minLat, box.maxLat, box.minLon, box.maxLon])

  return rows
    .map(r => ({
      name: r.name, snowAboveM: r.snow_above_m, takenAt: r.taken_at,
      distanceM: distanceM(of, { lat: r.lat, lon: r.lon }),
    }))
    .filter(r => r.distanceM <= withinM)
    .sort((a, b) => a.distanceM - b.distanceM)
}
