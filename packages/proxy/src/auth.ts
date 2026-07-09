import { createHmac, createHash, timingSafeEqual } from 'node:crypto'
import type { IncomingMessage, ServerResponse } from 'node:http'

/**
 * Proxy auth (ROADMAP.md Phase 5 Foundations): one shared token for the whole
 * proxy. Scripts send it as `Authorization: Bearer <token>` per request;
 * browsers exchange it once (POST /api/login) for an HttpOnly session cookie,
 * because EventSource can't set headers but does send cookies.
 *
 * Opt-in: no token configured means the proxy runs open, exactly as before
 * this shipped (index.ts logs a loud warning). Never expose it beyond a
 * trusted network in that state.
 */

const COOKIE_NAME = 'cf_session'
/** 30 days — re-entering the token monthly is a fine cost for no session store. */
const COOKIE_MAX_AGE_S = 2_592_000

/** Compares via fixed-length digests so neither content nor length leaks timing. */
function safeEqual(a: string, b: string): boolean {
  return timingSafeEqual(createHash('sha256').update(a).digest(), createHash('sha256').update(b).digest())
}

export interface Auth {
  enabled: boolean
  /** The configured token — only for the authorized-only GUI reveal route. */
  token: string
  isAuthorized(req: IncomingMessage): boolean
  /** Checks a candidate token (the login body), timing-safely. */
  tokenMatches(candidate: string): boolean
  setSessionCookie(res: ServerResponse): void
  clearSessionCookie(res: ServerResponse): void
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

export function createAuth(token: string | undefined): Auth {
  if (token === undefined || token === '') {
    return {
      enabled: false,
      token: '',
      isAuthorized: () => true,
      tokenMatches: () => false,
      setSessionCookie: () => undefined,
      clearSessionCookie: () => undefined,
    }
  }

  const session = sessionValue(token)
  return {
    enabled: true,
    token,
    isAuthorized(req) {
      const header = req.headers.authorization
      if (header !== undefined && header.startsWith('Bearer ')) {
        return safeEqual(header.slice('Bearer '.length), token)
      }
      const cookie = cookieValue(req, COOKIE_NAME)
      return cookie !== undefined && safeEqual(cookie, session)
    },
    tokenMatches(candidate) {
      return safeEqual(candidate, token)
    },
    setSessionCookie(res) {
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
  }
}
