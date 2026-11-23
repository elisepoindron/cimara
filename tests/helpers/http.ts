import { once } from 'node:events'
import type http from 'node:http'
import { freshDb } from './db.ts'
import { createServer } from '../../src/app/server.ts'
import type { Db } from '../../src/db/open.ts'
import { memoryPhotoStore } from './photo-store.ts'
import type { CallModel } from '../../src/app/synthesis.ts'
import type { FetchWeather } from '../../src/app/weather.ts'
import type { RewriteLine } from '../../src/app/find.ts'
import type { FetchTrail } from '../../src/app/trail.ts'

export interface RunningServer {
  readonly db: Db
  readonly server: http.Server
  readonly base: string
}

/**
 * A live server, on its own OS-picked port, over a fresh in-memory database.
 * Shared here because three tasks besides this one need a server to post to.
 *
 * `null` by default: a test that has no interest in synthesis gets a server
 * with no model configured, which is a real production state and keeps
 * `@anthropic-ai/sdk` out of this module graph entirely.
 */
export async function running(
  callModel: CallModel | null = null, fetchWeather: FetchWeather | null = null,
  rewriteLine: RewriteLine | null = null, fetchTrail: FetchTrail | null = null,
): Promise<RunningServer> {
  const db = await freshDb()
  const server = createServer(db, memoryPhotoStore(), memoryPhotoStore(), callModel, fetchWeather, rewriteLine, fetchTrail)
  server.listen(0)
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  return { db, server, base: `http://127.0.0.1:${port}` }
}

export interface PostResult {
  readonly status: number
  readonly cookies: readonly string[]
  readonly body: string
  readonly location: string | null
}

/** Posts a form, carrying cookies, without following redirects. */
export async function post(
  base: string, path: string, fields: Record<string, string>, cookie = '',
): Promise<PostResult> {
  const res = await fetch(base + path, {
    method: 'POST', redirect: 'manual',
    headers: { 'content-type': 'application/x-www-form-urlencoded', cookie },
    body: new URLSearchParams(fields).toString(),
  })
  return {
    status: res.status, cookies: res.headers.getSetCookie(), body: await res.text(),
    location: res.headers.get('location'),
  }
}

export interface TokenAndCookie {
  readonly token: string
  readonly cookie: string
}

/** Fetches a page and returns its CSRF token and the cookie to send back. */
export async function tokenFrom(base: string, path: string): Promise<TokenAndCookie> {
  const res = await fetch(base + path)
  const body = await res.text()
  const token = /name="csrf" value="([^"]+)"/.exec(body)?.[1] ?? ''
  const cookie = res.headers.getSetCookie()
    .map(c => c.split(';')[0]).join('; ')
  return { token, cookie }
}
