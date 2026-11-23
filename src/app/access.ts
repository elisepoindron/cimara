import { createPublicKey, verify, type JsonWebKey } from 'node:crypto'

/**
 * Cloudflare Access, checked by the app itself.
 *
 * Access sits in front of a deploy and lets through only the email addresses
 * on its list. Every request it lets through carries a token it signed — the
 * `Cf-Access-Jwt-Assertion` header, and the `CF_Authorization` cookie. Checking
 * that signature here is what closes the side door: the host's own address
 * (`*.up.railway.app`, or a request sent straight to its edge with our host
 * name) never passed through Access, so it carries no valid token and is
 * refused.
 *
 * Off unless both `CF_ACCESS_TEAM_DOMAIN` and `CF_ACCESS_AUD` are set, so a
 * local `npm start` and every test run open as before.
 */
export interface AccessConfig {
  /** `https://<team>.cloudflareaccess.com` — the token's issuer. */
  readonly issuer: string
  /** The Access application's audience tag. */
  readonly audience: string
}

/** Who Access let through, as far as the app needs to know. */
export interface AccessIdentity { readonly email: string | null }

/** The team's signing keys, as Access publishes them. */
export type FetchKeys = (issuer: string) => Promise<readonly JsonWebKey[]>

export type AccessGate = (token: string | null) => Promise<AccessIdentity | null>

/**
 * Reads the configuration from the environment. Null when Access is not in
 * use; throws when only half of it is set, because a deploy that meant to be
 * private and quietly isn't is the one failure nobody would notice.
 */
export function accessConfigFrom(env: NodeJS.ProcessEnv): AccessConfig | null {
  const team = env.CF_ACCESS_TEAM_DOMAIN?.trim()
  const audience = env.CF_ACCESS_AUD?.trim()
  if (!team && !audience) return null
  if (!team || !audience) {
    throw new Error('Cloudflare Access is half configured: set both CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD, or neither')
  }
  const host = team.replace(/^https?:\/\//, '').replace(/\/+$/, '')
  return { issuer: `https://${host}`, audience }
}

/** The token on a request: the header Access adds, else its cookie. */
export function accessTokenOf(headers: Record<string, string | string[] | undefined>,
                              cookies: ReadonlyMap<string, string>): string | null {
  const header = headers['cf-access-jwt-assertion']
  const fromHeader = Array.isArray(header) ? header[0] : header
  return fromHeader || cookies.get('CF_Authorization') || null
}

/** How long a fetched key set is trusted before an unknown key id may refetch it. */
const REFETCH_AFTER_MS = 60_000

/**
 * A gate over one Access application. Keys are fetched on first use and
 * refetched when a token names a key not yet seen — that is how Access key
 * rotation reaches a running process — but at most once a minute, so a flood
 * of forged key ids cannot turn into a flood of requests to Cloudflare.
 */
export function accessGate(config: AccessConfig, fetchKeys: FetchKeys,
                           now: () => number = Date.now): AccessGate {
  let keys = new Map<string, ReturnType<typeof createPublicKey>>()
  let fetchedAt = -Infinity

  async function keyFor(kid: string) {
    if (!keys.has(kid) && now() - fetchedAt >= REFETCH_AFTER_MS) {
      fetchedAt = now()
      const next = new Map<string, ReturnType<typeof createPublicKey>>()
      for (const jwk of await fetchKeys(config.issuer)) {
        if (typeof jwk.kid === 'string') next.set(jwk.kid, createPublicKey({ key: jwk, format: 'jwk' }))
      }
      keys = next
    }
    return keys.get(kid) ?? null
  }

  return async token => {
    if (!token) return null
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const [head, body, sig] = parts as [string, string, string]

    const header = decodeJson(head)
    const claims = decodeJson(body)
    if (!header || !claims) return null
    if (header.alg !== 'RS256' || typeof header.kid !== 'string') return null

    let key
    try { key = await keyFor(header.kid) } catch (err) {
      console.error('Cloudflare Access keys could not be fetched:', err)
      return null
    }
    if (!key) return null

    const signed = verify('RSA-SHA256', Buffer.from(`${head}.${body}`), key, Buffer.from(sig, 'base64url'))
    if (!signed) return null

    return claimsAccepted(claims, config, now()) ? { email: typeof claims.email === 'string' ? claims.email : null } : null
  }
}

/** Issuer, audience and time window — the checks a valid signature does not make on its own. */
export function claimsAccepted(claims: Record<string, unknown>, config: AccessConfig, nowMs: number): boolean {
  if (claims.iss !== config.issuer) return false
  const aud = Array.isArray(claims.aud) ? claims.aud : [claims.aud]
  if (!aud.includes(config.audience)) return false
  const nowS = nowMs / 1000
  if (typeof claims.exp !== 'number' || claims.exp <= nowS) return false
  if (typeof claims.nbf === 'number' && claims.nbf > nowS + 60) return false
  return true
}

function decodeJson(part: string): Record<string, unknown> | null {
  try {
    const value: unknown = JSON.parse(Buffer.from(part, 'base64url').toString('utf8'))
    return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null
  } catch {
    return null
  }
}

/** The real key fetch: Access publishes each team's keys at a fixed path. */
export const realFetchKeys: FetchKeys = async issuer => {
  const res = await fetch(`${issuer}/cdn-cgi/access/certs`, { signal: AbortSignal.timeout(5000) })
  if (!res.ok) throw new Error(`certs answered ${res.status}`)
  const body = await res.json() as { keys?: JsonWebKey[] }
  return body.keys ?? []
}
