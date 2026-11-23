import { test } from 'node:test'
import assert from 'node:assert/strict'
import { running, post, tokenFrom } from '../helpers/http.ts'

test('signing up sets a session cookie and redirects', async () => {
  const { server, base } = await running()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const r = await post(base, '/registrati', {
      csrf: token, email: 'elise@example.it', password: 'una password lunga', nome: 'elise',
    }, cookie)

    assert.equal(r.status, 303)
    assert.ok(r.cookies.some(c => c.startsWith('session=')), 'no session cookie')
    assert.ok(r.cookies.some(c => /HttpOnly/i.test(c)), 'the session cookie must be HttpOnly')
  } finally { server.close() }
})

test('a post without a token is refused', async () => {
  const { server, base } = await running()
  try {
    const { cookie } = await tokenFrom(base, '/registrati')
    const r = await post(base, '/registrati', {
      email: 'elise@example.it', password: 'una password lunga', nome: 'elise',
    }, cookie)

    assert.equal(r.status, 403)
  } finally { server.close() }
})

test('a post with someone else\'s token is refused', async () => {
  const { server, base } = await running()
  try {
    const { cookie } = await tokenFrom(base, '/registrati')
    const r = await post(base, '/registrati', {
      csrf: 'un-valore-inventato', email: 'e@example.it',
      password: 'una password lunga', nome: 'e',
    }, cookie)

    assert.equal(r.status, 403)
  } finally { server.close() }
})

test('a failed sign-up re-shows the form with the address still in it', async () => {
  const { server, base } = await running()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const r = await post(base, '/registrati',
      { csrf: token, email: 'non-valido', password: 'corta', nome: '' }, cookie)

    assert.equal(r.status, 200)
    assert.match(r.body, /non-valido/)
    assert.equal(r.body.includes('corta'), false, 'the password must not be echoed back')
  } finally { server.close() }
})

test('signing out clears the cookie', async () => {
  const { server, base } = await running()
  try {
    const { token, cookie } = await tokenFrom(base, '/registrati')
    const up = await post(base, '/registrati', {
      csrf: token, email: 'elise@example.it', password: 'una password lunga', nome: 'elise',
    }, cookie)

    const session = up.cookies.find(c => c.startsWith('session='))!.split(';')[0]
    const out = await post(base, '/esci', { csrf: token }, `${cookie}; ${session}`)

    assert.equal(out.status, 303)
    assert.ok(out.cookies.some(c => /^session=;/.test(c)))
  } finally { server.close() }
})

test('GET on a post-only path is 405, not 404', async () => {
  const { server, base } = await running()
  try {
    const res = await fetch(base + '/esci', { redirect: 'manual' })
    assert.equal(res.status, 405)
  } finally { server.close() }
})

const CREDENTIALS = { email: 'elise@example.it', password: 'una password lunga' }

/** Signs up a fresh account and returns the CSRF pair to sign in with. */
async function withAccount(base: string) {
  const { token, cookie } = await tokenFrom(base, '/registrati')
  await post(base, '/registrati', { csrf: token, nome: 'elise', ...CREDENTIALS }, cookie)
  return { token, cookie }
}

// `next` is attacker-controlled — it travels through a query string or a form
// field with nothing else validating it before safeNext() does. Each of these
// resolves off this server's own origin if a leading "/" is treated as enough
// of a check on its own: a browser (and node:url, which resolves a Location
// header by the same WHATWG algorithm) normalises a leading backslash exactly
// like a forward slash for http and https, so "/\host" behaves exactly like
// "//host" even though it fails a naive `.includes('//')` check. Confirmed
// end to end here, against the real redirect a successful sign-in sends —
// not just against the value re-shown in a failed form — because that is
// what actually reaches a browser's address bar.
const MALICIOUS_NEXT = [
  ['/\\evil.example.com', 'a leading backslash — the confirmed vulnerability'],
  ['//evil.example.com', 'a bare scheme-relative host'],
  ['//evil.example.com/ruba-sessione', 'a scheme-relative host with a path'],
  ['/gita\\..\\..', 'a backslash further into an otherwise ordinary path'],
  ['https://evil.example.com', 'an absolute URL with its own scheme'],
  ['/\t/evil.example.com', 'a literal tab between two slashes'],
] as const

for (const [next, why] of MALICIOUS_NEXT) {
  test(`a sign-in redirect never carries an attacker to another origin (${why})`, async () => {
    const { server, base } = await running()
    try {
      await withAccount(base)
      const { token, cookie } = await tokenFrom(base, '/accedi')
      const r = await post(base, '/accedi', { csrf: token, next, ...CREDENTIALS }, cookie)

      assert.equal(r.status, 303)
      assert.equal(r.location, '/', `Location must not be ${JSON.stringify(next)}`)
    } finally { server.close() }
  })
}

// Tab, CR and LF are stripped by the WHATWG URL algorithm before it ever
// decides where a browser goes — a raw-string denylist answers a different
// question from that one, which is exactly how "//", then "\", then a tab
// each walked through in turn. These three specifically must not become a
// 500 either: a raw control character is illegal in a header value, so a
// guard that returns the caller's string unexamined can crash writeHead.
const CONTROL_CHAR_NEXT = [
  ['/\t/evil.example.com', 'a literal tab'],
  ['/\r/evil.example.com', 'a literal CR'],
  ['/\n/evil.example.com', 'a literal LF'],
  ['/\r\n/evil.example.com', 'a literal CRLF'],
] as const

for (const [next, why] of CONTROL_CHAR_NEXT) {
  test(`a sign-in redirect with ${why} in next neither escapes nor crashes`, async () => {
    const { server, base } = await running()
    try {
      await withAccount(base)
      const { token, cookie } = await tokenFrom(base, '/accedi')
      const r = await post(base, '/accedi', { csrf: token, next, ...CREDENTIALS }, cookie)

      assert.notEqual(r.status, 500, 'a malformed next must not crash the handler')
      assert.equal(r.status, 303)
      assert.equal(r.location, '/', `Location must not be ${JSON.stringify(next)}`)
    } finally { server.close() }
  })
}

// A guard tight enough to reject everything would pass every test above
// while breaking the feature it exists to support — these prove the
// legitimate case still works, reconstructed exactly, including a query
// string, a fragment, and the encoded space and accented characters real
// Italian route names will carry.
const LEGITIMATE_NEXT = [
  '/gita/nuova?itinerario=abc#sezione',
  '/gita/Cima%20Bianca',
  '/cerca?q=localit%C3%A0',
] as const

for (const next of LEGITIMATE_NEXT) {
  test(`a legitimate next (${next}) round-trips intact through a successful sign-in`, async () => {
    const { server, base } = await running()
    try {
      await withAccount(base)
      const { token, cookie } = await tokenFrom(base, '/accedi')
      const r = await post(base, '/accedi', { csrf: token, next, ...CREDENTIALS }, cookie)

      assert.equal(r.status, 303)
      assert.equal(r.location, next)
    } finally { server.close() }
  })
}
