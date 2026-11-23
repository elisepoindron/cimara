import { test } from 'node:test'
import assert from 'node:assert/strict'
import { once } from 'node:events'
import { generateKeyPairSync, sign, type KeyObject } from 'node:crypto'
import { freshDb } from '../helpers/db.ts'
import { createServer } from '../../src/app/server.ts'
import { memoryPhotoStore } from '../helpers/photo-store.ts'
import {
  accessConfigFrom, accessGate, accessTokenOf, claimsAccepted, type AccessConfig,
} from '../../src/app/access.ts'

const CONFIG: AccessConfig = { issuer: 'https://team.cloudflareaccess.com', audience: 'aud-tag' }
const NOW = Date.parse('2026-11-16T12:00:00Z')
const NOW_S = NOW / 1000

function keyPair(kid: string) {
  const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 })
  return { kid, privateKey, jwk: { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256' } }
}

function token(privateKey: KeyObject, kid: string, claims: Record<string, unknown>, alg = 'RS256') {
  const enc = (v: unknown) => Buffer.from(JSON.stringify(v)).toString('base64url')
  const head = enc({ alg, kid, typ: 'JWT' })
  const body = enc(claims)
  const sig = sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey).toString('base64url')
  return `${head}.${body}.${sig}`
}

const GOOD = { iss: CONFIG.issuer, aud: [CONFIG.audience], exp: NOW_S + 3600, nbf: NOW_S - 10, email: 'marco@example.com' }

test('configuration is off when neither variable is set', () => {
  assert.equal(accessConfigFrom({}), null)
})

test('configuration accepts a bare team domain and normalises it to an issuer', () => {
  assert.deepEqual(
    accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: 'team.cloudflareaccess.com/', CF_ACCESS_AUD: 'aud-tag' }),
    CONFIG)
  assert.deepEqual(
    accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: 'https://team.cloudflareaccess.com', CF_ACCESS_AUD: 'aud-tag' }),
    CONFIG)
})

test('half a configuration refuses to start rather than run open', () => {
  assert.throws(() => accessConfigFrom({ CF_ACCESS_AUD: 'aud-tag' }), /half configured/)
  assert.throws(() => accessConfigFrom({ CF_ACCESS_TEAM_DOMAIN: 'x.cloudflareaccess.com' }), /half configured/)
})

test('the token is read from the Access header, else its cookie', () => {
  const jar = new Map([['CF_Authorization', 'c']])
  assert.equal(accessTokenOf({ 'cf-access-jwt-assertion': 'h' }, jar), 'h')
  assert.equal(accessTokenOf({}, jar), 'c')
  assert.equal(accessTokenOf({}, new Map()), null)
})

test('claims: issuer, audience and expiry are each required', () => {
  assert.equal(claimsAccepted(GOOD, CONFIG, NOW), true)
  assert.equal(claimsAccepted({ ...GOOD, aud: 'aud-tag' }, CONFIG, NOW), true)
  assert.equal(claimsAccepted({ ...GOOD, iss: 'https://other.cloudflareaccess.com' }, CONFIG, NOW), false)
  assert.equal(claimsAccepted({ ...GOOD, aud: ['another-app'] }, CONFIG, NOW), false)
  assert.equal(claimsAccepted({ ...GOOD, exp: NOW_S - 1 }, CONFIG, NOW), false)
  assert.equal(claimsAccepted({ ...GOOD, exp: undefined }, CONFIG, NOW), false)
  assert.equal(claimsAccepted({ ...GOOD, nbf: NOW_S + 3600 }, CONFIG, NOW), false)
})

test('a token Access signed is let through, with its email', async () => {
  const k = keyPair('k1')
  const gate = accessGate(CONFIG, async () => [k.jwk], () => NOW)
  assert.deepEqual(await gate(token(k.privateKey, 'k1', GOOD)), { email: 'marco@example.com' })
})

test('no token, a malformed one, or one signed by another key is refused', async () => {
  const k = keyPair('k1')
  const forger = keyPair('k1')
  const gate = accessGate(CONFIG, async () => [k.jwk], () => NOW)
  assert.equal(await gate(null), null)
  assert.equal(await gate('not-a-jwt'), null)
  assert.equal(await gate('a.b.c'), null)
  assert.equal(await gate(token(forger.privateKey, 'k1', GOOD)), null)
  assert.equal(await gate(token(k.privateKey, 'k1', GOOD, 'none')), null)
})

test('a tampered payload no longer matches its signature', async () => {
  const k = keyPair('k1')
  const gate = accessGate(CONFIG, async () => [k.jwk], () => NOW)
  const [head, , sig] = token(k.privateKey, 'k1', GOOD).split('.')
  const body = Buffer.from(JSON.stringify({ ...GOOD, email: 'intruder@example.com' })).toString('base64url')
  assert.equal(await gate(`${head}.${body}.${sig}`), null)
})

test('a rotated key is picked up, but unknown key ids refetch at most once a minute', async () => {
  const old = keyPair('old')
  const rotated = keyPair('new')
  let published = [old.jwk]
  let fetches = 0
  let clock = NOW
  const gate = accessGate(CONFIG, async () => { fetches++; return published }, () => clock)

  assert.ok(await gate(token(old.privateKey, 'old', GOOD)))
  assert.equal(fetches, 1)

  published = [old.jwk, rotated.jwk]
  // Within the minute, an unseen key id does not reach Cloudflare again.
  assert.equal(await gate(token(rotated.privateKey, 'new', GOOD)), null)
  assert.equal(await gate(token(rotated.privateKey, 'unknown', GOOD)), null)
  assert.equal(fetches, 1)

  clock += 61_000
  assert.ok(await gate(token(rotated.privateKey, 'new', { ...GOOD, exp: clock / 1000 + 3600 })))
  assert.equal(fetches, 2)
})

test('keys that cannot be fetched refuse the request rather than open the door', async () => {
  const k = keyPair('k1')
  const gate = accessGate(CONFIG, async () => { throw new Error('offline') }, () => NOW)
  const quiet = console.error
  console.error = () => {}
  try {
    assert.equal(await gate(token(k.privateKey, 'k1', GOOD)), null)
  } finally {
    console.error = quiet
  }
})

test('behind the gate, the server answers 403 without a token and serves with one', async () => {
  const k = keyPair('k1')
  // The real clock: the server asks the gate with no clock of its own.
  const live = { ...GOOD, exp: Date.now() / 1000 + 3600, nbf: Date.now() / 1000 - 10 }
  const gate = accessGate(CONFIG, async () => [k.jwk])
  const db = await freshDb()
  const server = createServer(db, memoryPhotoStore(), memoryPhotoStore(), null, null, null, null, gate)
  server.listen(0)
  await once(server, 'listening')
  const { port } = server.address() as { port: number }
  const base = `http://127.0.0.1:${port}`
  try {
    const refused = await fetch(`${base}/app.css`)
    assert.equal(refused.status, 403)
    assert.match(await refused.text(), /Accesso riservato/)

    const viaHeader = await fetch(`${base}/app.css`, {
      headers: { 'cf-access-jwt-assertion': token(k.privateKey, 'k1', live) },
    })
    assert.equal(viaHeader.status, 200)
    await viaHeader.arrayBuffer()

    const viaCookie = await fetch(`${base}/app.css`, {
      headers: { cookie: `CF_Authorization=${token(k.privateKey, 'k1', live)}` },
    })
    assert.equal(viaCookie.status, 200)
    await viaCookie.arrayBuffer()
  } finally {
    server.close()
    await db.close()
  }
})
