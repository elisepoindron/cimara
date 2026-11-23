import type { IncomingMessage } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { brand } from '../render/site.ts'

/** Generous for a trip report's prose; a body without a cap is a memory leak with a URL. */
export const MAX_BODY_BYTES = 262_144

export class BodyTooLarge extends Error {}

export const SESSION_COOKIE = 'session'
export const CSRF_COOKIE = 'csrf'

/**
 * Whether cookies go out `Secure` and `__Host-` prefixed: the deployment
 * switch, `SECURE_COOKIES=1`.
 */
export const secureCookies = (env: NodeJS.ProcessEnv = process.env): boolean =>
  env.SECURE_COOKIES === '1'

/**
 * The names a cookie was given before this one: the brand's old prefix, where
 * it had one (`src/seed/sets/<set>/brand/brand.json`). Renaming the cookies
 * signed nobody out, because every read still accepts these, and signing out
 * clears them too.
 */
function legacyNames(name: string): string[] {
  const prefix = brand().legacyCookiePrefix
  return prefix ? [`${prefix}${name}`] : []
}

/**
 * `__Host-` is a promise a browser enforces: the cookie must carry `Secure`,
 * must be `Path=/`, and must carry no `Domain` — so nothing on a sibling
 * subdomain can set a cookie of that name and have ours silently shadowed.
 *
 * It can only be used where `Secure` can, and `Secure` over plain HTTP makes a
 * cookie vanish. So the prefix arrives with HTTPS and not before, which is why
 * every read below accepts either name: a browser holding the plain one is a
 * browser that was talking to a development server.
 */
export const hostPrefixed = (name: string, secure: boolean) =>
  secure ? `__Host-${name}` : name

/**
 * The value of a cookie under either of its names, preferring the guarded one.
 * A request that somehow carries both is a request where somebody set the
 * unguarded name, which is the attack the prefix exists to stop.
 */
export function cookie(
  jar: Map<string, string>, name: string,
): string | undefined {
  // Every guarded name before any plain one: a plain `session` set by a
  // sibling subdomain must not shadow a guarded `__Host-` cookie of the old name.
  const names = [name, ...legacyNames(name)]
  for (const n of [...names.map(n => `__Host-${n}`), ...names]) {
    const value = jar.get(n)
    if (value !== undefined) return value
  }
  return undefined
}

export async function readFormBody(req: IncomingMessage): Promise<Map<string, string>> {
  const chunks: Buffer[] = []
  let size = 0

  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > MAX_BODY_BYTES) throw new BodyTooLarge(`body exceeds ${MAX_BODY_BYTES} bytes`)
    chunks.push(buf)
  }

  return new Map(new URLSearchParams(Buffer.concat(chunks).toString('utf8')))
}

/** Generous for six photos plus the rest of the composer; still a memory leak with a URL if unbounded. */
export const MAX_PHOTO_BODY_BYTES = 50_000_000

export interface UploadedFile {
  readonly field: string
  readonly filename: string
  readonly contentType: string
  readonly bytes: Buffer
}

/**
 * A hand-rolled `multipart/form-data` reader — the format is simple enough to
 * parse without a library, and zero runtime dependencies is a hard rule here.
 * Used only by the one route that needs it; every other form still posts
 * `application/x-www-form-urlencoded` through `readFormBody`.
 */
export async function readMultipartBody(
  req: IncomingMessage, contentType: string, maxBytes: number,
): Promise<{ fields: Map<string, string>; files: UploadedFile[] }> {
  const boundaryMatch = /boundary=(?:"([^"]+)"|([^;]+))/.exec(contentType)
  const boundary = boundaryMatch?.[1] ?? boundaryMatch?.[2]
  if (!boundary) throw new Error('multipart body with no boundary')

  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of req) {
    const buf = chunk as Buffer
    size += buf.length
    if (size > maxBytes) throw new BodyTooLarge(`body exceeds ${maxBytes} bytes`)
    chunks.push(buf)
  }
  const body = Buffer.concat(chunks)
  const delimiter = Buffer.from(`--${boundary}`)

  const fields = new Map<string, string>()
  const files: UploadedFile[] = []

  let start = body.indexOf(delimiter)
  while (start !== -1) {
    const partStart = start + delimiter.length
    // "--" right after the boundary marks the final delimiter; anything else
    // is CRLF followed by a real part.
    if (body[partStart] === 0x2d && body[partStart + 1] === 0x2d) break

    // Not CRLF-anchored, so this matches the literal bytes "--<boundary>"
    // wherever they occur, even inside a part's own content — RFC 2046 defines
    // a real encapsulation boundary as preceded by CRLF, which this does not
    // check. Accepted deliberately: a real client's boundary is a long random
    // token, so an accidental collision inside real photo bytes is
    // astronomically unlikely, and a client that engineers one on purpose can
    // only corrupt the parsing of its own upload, never another user's.
    const next = body.indexOf(delimiter, partStart)
    if (next === -1) break

    // Each part is "\r\n<headers>\r\n\r\n<content>\r\n" up to the next delimiter.
    const part = body.subarray(partStart + 2, next - 2)
    const headerEnd = part.indexOf('\r\n\r\n')
    if (headerEnd === -1) { start = next; continue }

    const headerText = part.subarray(0, headerEnd).toString('utf8')
    const content = Buffer.from(part.subarray(headerEnd + 4))

    const name = /name="([^"]*)"/.exec(headerText)?.[1] ?? ''
    const filename = /filename="([^"]*)"/.exec(headerText)
    const declaredType = /content-type:\s*([^\r\n]+)/i.exec(headerText)?.[1]?.trim()

    if (filename) {
      files.push({
        field: name, filename: filename[1] ?? '',
        contentType: declaredType ?? 'application/octet-stream', bytes: content,
      })
    } else if (name) {
      fields.set(name, content.toString('utf8'))
    }

    start = next
  }

  return { fields, files }
}

export function parseCookies(header: string | undefined): Map<string, string> {
  const jar = new Map<string, string>()
  if (!header) return jar

  for (const pair of header.split(';')) {
    const eq = pair.indexOf('=')
    if (eq === -1) continue
    // Only the FIRST "=" separates name from value; the value may contain more.
    // A header with the same name twice resolves last-wins, which is what a
    // browser does and what a `Map` does for free — pinned by a test, because
    // "whatever happens to happen" is not a rule.
    jar.set(pair.slice(0, eq).trim(), decode(pair.slice(eq + 1).trim()))
  }
  return jar
}

/**
 * A cookie value survives the trip intact, whatever is in it.
 *
 * Everything this project puts in a cookie today is base64url or a uuid, for
 * which encoding is a no-op — so this changes nothing now and closes the hole
 * where it would matter: a value carrying `;` would otherwise end the cookie
 * and have the rest of it read as attributes.
 */
const encode = (value: string) => encodeURIComponent(value)
const decode = (value: string) => {
  try {
    return decodeURIComponent(value)
  } catch {
    // A value nobody of ours wrote, and not valid percent-encoding. Hand it back
    // as it came rather than throwing: a malformed cookie is a request that
    // authenticates nobody, not a 500.
    return value
  }
}

export function setCookie(
  name: string, value: string, opts: { maxAgeSeconds: number; secure: boolean },
): string {
  const parts = [
    `${hostPrefixed(name, opts.secure)}=${encode(value)}`,
    'Path=/', 'HttpOnly', 'SameSite=Lax',
    `Max-Age=${opts.maxAgeSeconds}`,
  ]
  // Secure over plain HTTP makes the cookie silently vanish, which is how local
  // development mysteriously stops keeping anyone signed in.
  if (opts.secure) parts.push('Secure')
  return parts.join('; ')
}

/**
 * Cleared under both names, because a browser may be holding either: one was
 * set before this deployment had HTTPS, and clearing only the guarded name
 * would leave the other one authenticating somebody.
 */
export function clearCookie(name: string): readonly string[] {
  return [name, ...legacyNames(name)].flatMap(n => [
    `${n}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`,
    `__Host-${n}=; Path=/; HttpOnly; SameSite=Lax; Secure; Max-Age=0`,
  ])
}

/**
 * Double-submit: a random value in a cookie, the same value in every form. A
 * site that makes your browser post to us causes the cookie to be sent but
 * cannot read it to fill in the field. No secret, no storage, and it works
 * before anyone has signed in — which the sign-in form needs.
 */
export function csrfTokenFor(req: IncomingMessage): { token: string; setCookie: string | null } {
  const existing = cookie(parseCookies(req.headers.cookie), CSRF_COOKIE)
  if (existing) return { token: existing, setCookie: null }

  const token = randomBytes(32).toString('base64url')
  return {
    token,
    setCookie: setCookie(CSRF_COOKIE, token, {
      maxAgeSeconds: 60 * 60 * 24 * 30,
      secure: secureCookies(),
    }),
  }
}

export function csrfOk(req: IncomingMessage, body: Map<string, string>): boolean {
  const held = cookie(parseCookies(req.headers.cookie), CSRF_COOKIE)
  const field = body.get('csrf')
  if (!held || !field) return false

  const a = Buffer.from(held)
  const b = Buffer.from(field)
  return a.length === b.length && timingSafeEqual(a, b)
}
