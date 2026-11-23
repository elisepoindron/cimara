import { randomBytes, scrypt, timingSafeEqual } from 'node:crypto'
import { promisify } from 'node:util'

const derive = promisify(scrypt) as
  (password: string, salt: Buffer, keylen: number, options: { N: number; r: number; p: number })
    => Promise<Buffer>

/**
 * Length is the only rule: composition rules push people toward predictable
 * substitutions. Relaxed for now to "not empty" while the app is being tried
 * out; the intended minimum is ten, and raising this number restores it.
 */
export const MIN_PASSWORD_LENGTH = 1

export class WeakPassword extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'WeakPassword'
  }
}

const N = 16_384        // 128 * N * r = 16 MB of work per hash
const R = 8
const P = 1
const KEY_BYTES = 64
const SALT_BYTES = 16

const b64 = (b: Buffer) => b.toString('base64url')

/** "scrypt$N$r$p$salt$hash" — self-describing, so the parameters can change later. */
export async function hashPassword(plain: string): Promise<string> {
  if (plain.length < MIN_PASSWORD_LENGTH) {
    throw new WeakPassword(`a password needs at least ${MIN_PASSWORD_LENGTH} characters`)
  }
  const salt = randomBytes(SALT_BYTES)
  const key = await derive(plain, salt, KEY_BYTES, { N, r: R, p: P })
  return `scrypt$${N}$${R}$${P}$${b64(salt)}$${b64(key)}`
}

/**
 * False for a wrong password AND for a stored value we cannot read. A corrupted
 * row must not take the sign-in route down.
 */
export async function verifyPassword(plain: string, stored: string): Promise<boolean> {
  const parts = stored.split('$')
  if (parts.length !== 6 || parts[0] !== 'scrypt') return false

  const [, n, r, p, saltB64, hashB64] = parts
  const opts = { N: Number(n), r: Number(r), p: Number(p) }
  if (!Number.isInteger(opts.N) || !Number.isInteger(opts.r) || !Number.isInteger(opts.p)) {
    return false
  }

  let expected: Buffer
  try {
    expected = Buffer.from(hashB64!, 'base64url')
    // keylen must come from our own constant, never from the stored string:
    // scrypt's derivation is prefix-stable, so deriving to match a truncated
    // hash's length would only check that hash's first bytes.
    if (expected.length !== KEY_BYTES) return false
    const actual = await derive(plain, Buffer.from(saltB64!, 'base64url'), KEY_BYTES, opts)
    return timingSafeEqual(actual, expected)
  } catch {
    return false
  }
}
