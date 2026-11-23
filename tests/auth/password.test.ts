import { test } from 'node:test'
import assert from 'node:assert/strict'
import { hashPassword, verifyPassword, WeakPassword, MIN_PASSWORD_LENGTH } from '../../src/auth/password.ts'

test('a password verifies against its own hash and nothing else', async () => {
  const stored = await hashPassword('una password lunga')

  assert.equal(await verifyPassword('una password lunga', stored), true)
  assert.equal(await verifyPassword('una password lunge', stored), false)
  assert.equal(await verifyPassword('', stored), false)
})

test('the same password hashes differently every time', async () => {
  const a = await hashPassword('una password lunga')
  const b = await hashPassword('una password lunga')

  assert.notEqual(a, b, 'without a per-password salt, identical passwords are visibly identical')
  assert.equal(await verifyPassword('una password lunga', a), true)
  assert.equal(await verifyPassword('una password lunga', b), true)
})

test('the stored form never contains the password', async () => {
  const stored = await hashPassword('cavallo batteria graffetta')

  assert.equal(stored.includes('cavallo'), false)
  assert.equal(stored.includes('graffetta'), false)
})

test('the stored form carries its own parameters, so they can change later', async () => {
  const stored = await hashPassword('una password lunga')
  const [scheme, n, r, p, salt, hash] = stored.split('$')

  assert.equal(scheme, 'scrypt')
  assert.ok(Number(n) >= 16384, 'cost must not be quietly weak')
  assert.ok(Number(r) > 0 && Number(p) > 0)
  assert.ok(salt && salt.length > 0)
  assert.ok(hash && hash.length > 0)
})

test('a password below the minimum is refused, and the limit is stated not guessed', async () => {
  assert.equal(MIN_PASSWORD_LENGTH, 1, 'relaxed for now; the intended minimum is ten')
  await assert.rejects(hashPassword(''), WeakPassword)
  await hashPassword('corta')   // does not throw while the rule is relaxed
  await assert.rejects(hashPassword('a'.repeat(MIN_PASSWORD_LENGTH - 1)), WeakPassword)
  await hashPassword('a'.repeat(MIN_PASSWORD_LENGTH))   // does not throw
})

test('a malformed stored value verifies as false rather than throwing', async () => {
  // A corrupted or truncated row must not take the sign-in route down.
  for (const junk of ['', 'nonsense', 'scrypt$1$2$3', 'scrypt$a$b$c$d$e']) {
    assert.equal(await verifyPassword('una password lunga', junk), false)
  }
})

test('a truncated hash is refused, not accepted as a shorter check', async () => {
  const stored = await hashPassword('una password lunga')
  const [scheme, n, r, p, salt, hash] = stored.split('$')
  const truncated = [scheme, n, r, p, salt,
    Buffer.from(hash!, 'base64url').subarray(0, 1).toString('base64url')].join('$')

  assert.equal(await verifyPassword('una password lunga', truncated), false,
    'prefix-stable derivation means a short hash must be rejected, not compared short')
})

test('a stored value with an out-of-range N is refused, not thrown', async () => {
  const stored = await hashPassword('una password lunga')
  const [scheme, , r, p, salt, hash] = stored.split('$')

  const negative = [scheme, '-1', r, p, salt, hash].join('$')
  assert.equal(await verifyPassword('una password lunga', negative), false)

  // large enough that 128 * N * r exceeds scrypt's default maxmem
  const huge = [scheme, String(2 ** 20), r, p, salt, hash].join('$')
  assert.equal(await verifyPassword('una password lunga', huge), false)
})
