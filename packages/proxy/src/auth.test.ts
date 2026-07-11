import { describe, expect, it, vi } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { AuthError, createAuth, generateToken, MIN_TOKEN_LENGTH } from './auth.ts'

function req(headers: Record<string, string> = {}): IncomingMessage {
  return { headers } as IncomingMessage
}

/** Captures Set-Cookie without a real socket. */
function res(): ServerResponse & { cookies: string[] } {
  const cookies: string[] = []
  return {
    cookies,
    setHeader(name: string, value: string) {
      if (name === 'Set-Cookie') cookies.push(value)
    },
  } as unknown as ServerResponse & { cookies: string[] }
}

function cookieOf(auth: ReturnType<typeof createAuth>): string {
  const r = res()
  auth.setSessionCookie(r)
  return r.cookies[0]!.split(';')[0]!
}

describe('createAuth disabled (no token)', () => {
  it('authorizes everything and never matches a login attempt', () => {
    const auth = createAuth()
    expect(auth.enabled).toBe(false)
    expect(auth.isAuthorized(req())).toBe(true)
    expect(auth.tokenMatches('anything')).toBe(false)

    expect(createAuth({ token: '' }).enabled).toBe(false)
  })
})

describe('createAuth enabled', () => {
  it('accepts the exact bearer token and rejects wrong or differently-sized ones', () => {
    const auth = createAuth({ token: 'sekrit-token-value' })
    expect(auth.isAuthorized(req({ authorization: 'Bearer sekrit-token-value' }))).toBe(true)
    expect(auth.isAuthorized(req({ authorization: 'Bearer sekrit-token-valu' }))).toBe(false)
    expect(auth.isAuthorized(req({ authorization: 'Bearer sekrit-token-value-more' }))).toBe(false)
    expect(auth.isAuthorized(req({ authorization: 'Basic sekrit-token-value' }))).toBe(false)
    expect(auth.isAuthorized(req())).toBe(false)
  })

  it('accepts the session cookie its own login flow sets, among other cookies', () => {
    const auth = createAuth({ token: 'sekrit-token-value' })
    const r = res()
    auth.setSessionCookie(r)
    const cookie = r.cookies[0]!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')

    const value = cookie.split(';')[0]!
    expect(auth.isAuthorized(req({ cookie: `theme=dark; ${value}; other=1` }))).toBe(true)
    expect(auth.isAuthorized(req({ cookie: 'cf_session=wrong' }))).toBe(false)
  })

  it('clearSessionCookie expires the cookie immediately', () => {
    const auth = createAuth({ token: 'sekrit-token-value' })
    const r = res()
    auth.clearSessionCookie(r)
    expect(r.cookies[0]).toContain('Max-Age=0')
  })
})

describe('setToken (initialise / rotate)', () => {
  it('enables auth from the open state and persists the new token', () => {
    const persist = vi.fn()
    const auth = createAuth({ persist })
    expect(auth.enabled).toBe(false)
    expect(auth.isAuthorized(req())).toBe(true)

    auth.setToken('a-freshly-set-token')
    expect(persist).toHaveBeenCalledWith('a-freshly-set-token')
    expect(auth.enabled).toBe(true)
    expect(auth.token).toBe('a-freshly-set-token')
    // The new token now gates access, and its own cookie authorizes.
    expect(auth.isAuthorized(req())).toBe(false)
    expect(auth.isAuthorized(req({ cookie: cookieOf(auth) }))).toBe(true)
  })

  it('rotating invalidates cookies issued under the previous token', () => {
    const auth = createAuth({ token: 'the-first-token-value' })
    const oldCookie = cookieOf(auth)
    expect(auth.isAuthorized(req({ cookie: oldCookie }))).toBe(true)

    auth.setToken('the-second-token-value')
    expect(auth.isAuthorized(req({ cookie: oldCookie }))).toBe(false)
    expect(auth.isAuthorized(req({ cookie: cookieOf(auth) }))).toBe(true)
    expect(auth.isAuthorized(req({ authorization: 'Bearer the-second-token-value' }))).toBe(true)
  })

  it('rejects a token shorter than the minimum', () => {
    const auth = createAuth()
    expect(() => auth.setToken('short')).toThrow(AuthError)
    expect('x'.repeat(MIN_TOKEN_LENGTH).length).toBe(MIN_TOKEN_LENGTH)
    expect(() => auth.setToken('x'.repeat(MIN_TOKEN_LENGTH))).not.toThrow()
  })

  it('leaves the token unchanged when persisting fails', () => {
    const failingPersist = () => {
      throw new Error('disk full')
    }

    // Rotation: the old token and its cookies must stay valid.
    const auth = createAuth({ token: 'the-first-token-value', persist: failingPersist })
    const oldCookie = cookieOf(auth)
    expect(() => auth.setToken('the-second-token-value')).toThrow('disk full')
    expect(auth.token).toBe('the-first-token-value')
    expect(auth.isAuthorized(req({ cookie: oldCookie }))).toBe(true)
    expect(auth.isAuthorized(req({ authorization: 'Bearer the-first-token-value' }))).toBe(true)
    expect(auth.isAuthorized(req({ authorization: 'Bearer the-second-token-value' }))).toBe(false)

    // Initialisation: the proxy must stay open rather than enable an
    // in-memory-only token that a restart would silently drop.
    const open = createAuth({ persist: failingPersist })
    expect(() => open.setToken('a-freshly-set-token')).toThrow('disk full')
    expect(open.enabled).toBe(false)
    expect(open.isAuthorized(req())).toBe(true)
  })

  it('refuses to change an env-managed token', () => {
    const persist = vi.fn()
    const auth = createAuth({ token: 'env-token-value', managedByEnv: true, persist })
    expect(auth.managedByEnv).toBe(true)
    expect(() => auth.setToken('a-new-long-token-value')).toThrow(AuthError)
    expect(persist).not.toHaveBeenCalled()
    // The env token still authorizes.
    expect(auth.isAuthorized(req({ authorization: 'Bearer env-token-value' }))).toBe(true)
  })
})

describe('generateToken', () => {
  it('produces a long, url-safe, unique token', () => {
    const a = generateToken()
    const b = generateToken()
    expect(a).not.toBe(b)
    expect(a.length).toBeGreaterThanOrEqual(MIN_TOKEN_LENGTH)
    expect(a).toMatch(/^[A-Za-z0-9_-]+$/)
  })
})
