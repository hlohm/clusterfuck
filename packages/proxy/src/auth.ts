import { createHmac, createHash, randomBytes, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Proxy auth (ROADMAP.md Phase 5 Foundations): one shared token for the whole
 * proxy. Scripts send it as `Authorization: Bearer <token>` per request;
 * browsers exchange it once (POST /api/login) for an HttpOnly session cookie,
 * because EventSource can't set headers but does send cookies.
 *
 * The token is runtime-mutable: it can be initialised, rotated, or generated
 * from the GUI (PUT /api/auth/token), persisted server-side via the injected
 * `persist` callback. When set from the CLUSTERFUCK_TOKEN environment variable
 * it is instead authoritative and read-only (`managedByEnv`) — an ops-managed
 * deployment can't be re-pointed from a browser.
 *
 * Opt-in: no token means the proxy runs open, exactly as before auth shipped
 * (index.ts logs a loud warning). There is deliberately no GUI "disable" —
 * going back to open requires removing the token file and restarting.
 */

const COOKIE_NAME = 'cf_session'
/** 30 days — re-entering the token monthly is a fine cost for no session store. */
const COOKIE_MAX_AGE_S = 2_592_000
/** Reject trivially short tokens; a generated one is much longer. */
export const MIN_TOKEN_LENGTH = 16

/** Thrown when a mutation is invalid — an env-managed token, or one too short. */
export class AuthError extends Error {}

/** Compares via fixed-length digests so neither content nor length leaks timing. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

/** A strong URL-safe token for the "generate" path (192 bits). */
export function generateToken(): string {
  return randomBytes(24).toString('base64url')
}

export interface Auth {
  readonly enabled: boolean
  /** The configured token — only for the authorized-only GUI reveal route. */
  readonly token: string
  /** True when the token comes from CLUSTERFUCK_TOKEN — the GUI can't change it. */
  readonly managedByEnv: boolean
  isAuthorized(req: IncomingMessage): boolean
  /** Checks a candidate token (the login body), timing-safely. */
  tokenMatches(candidate: string): boolean
  setSessionCookie(res: ServerResponse): void
  clearSessionCookie(res: ServerResponse): void
  /**
   * Sets (initialises or rotates) the token and persists it. Throws AuthError
   * if the token is env-managed or too short. Rotating changes the session
   * HMAC, so every previously-issued cookie stops validating at once. If the
   * persist callback throws, the error propagates and the active token is
   * unchanged — in-memory state never diverges from what's on disk.
   */
  setToken(next: string): void
}

/**
 * The session cookie's value is stateless: an HMAC of a fixed label keyed by
 * the token. It survives proxy restarts with no session store, and rotating
 * the token invalidates every outstanding cookie at once. It is a derived
 * long-lived credential — same trust class as the token, without exposing
 * the token itself to `document.cookie`-adjacent bugs (it's HttpOnly anyway).
 */
function sessionValue(token: string): string {
  return createHmac('sha256', token).update('clusterfuck-session-v1').digest('hex')
}

function cookieValue(req: IncomingMessage, name: string): string | undefined {
  const header = req.headers.cookie
  if (header === undefined) return undefined
  for (const part of header.split(';')) {
    const eq = part.indexOf('=')
    if (eq === -1) continue
    if (part.slice(0, eq).trim() === name) return part.slice(eq + 1).trim()
  }
  return undefined
}

export interface CreateAuthOptions {
  /** Initial token, if any (from the env var or the persisted file). */
  token?: string
  /** True when `token` came from CLUSTERFUCK_TOKEN — makes it read-only. */
  managedByEnv?: boolean
  /** Persists a newly set/rotated token; only called for non-env-managed tokens. */
  persist?: (token: string) => void
}

/**
 * Builds the auth manager. All the reader methods (isAuthorized, enabled,
 * token) read the current mutable state, so a `setToken` at runtime is picked
 * up everywhere the server already holds this object — no re-wiring needed.
 */
export function createAuth(options: CreateAuthOptions = {}): Auth {
  const managedByEnv = options.managedByEnv ?? false
  let token = options.token !== undefined && options.token !== '' ? options.token : undefined
  let session = token !== undefined ? sessionValue(token) : undefined

  return {
    get enabled() {
      return token !== undefined
    },
    get token() {
      return token ?? ''
    },
    managedByEnv,
    isAuthorized(req) {
      if (token === undefined) return true // open proxy
      const header = req.headers.authorization
      if (header !== undefined && header.startsWith('Bearer ')) {
        return safeEqual(header.slice('Bearer '.length), token)
      }
      const cookie = cookieValue(req, COOKIE_NAME)
      return cookie !== undefined && session !== undefined && safeEqual(cookie, session)
    },
    tokenMatches(candidate) {
      return token !== undefined && safeEqual(candidate, token)
    },
    setSessionCookie(res) {
      if (session === undefined) return
      // No `Secure` attribute: plain-HTTP LAN deployments are this tool's
      // normal habitat, and Secure would silently drop the cookie there.
      // SameSite=Strict keeps cross-site requests from riding the session.
      res.setHeader(
        'Set-Cookie',
        `${COOKIE_NAME}=${session}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${COOKIE_MAX_AGE_S}`,
      )
    },
    clearSessionCookie(res) {
      res.setHeader('Set-Cookie', `${COOKIE_NAME}=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0`)
    },
    setToken(next) {
      if (managedByEnv) {
        throw new AuthError('the token is managed by the CLUSTERFUCK_TOKEN environment variable')
      }
      if (typeof next !== 'string' || next.length < MIN_TOKEN_LENGTH) {
        throw new AuthError(`token must be at least ${MIN_TOKEN_LENGTH} characters`)
      }
      // Persist before mutating: if the disk write fails, the in-memory token
      // must not change either, or the next restart would silently revert to
      // the previous token — one the operator may have already discarded.
      options.persist?.(next)
      token = next
      session = sessionValue(next)
    },
  }
}
