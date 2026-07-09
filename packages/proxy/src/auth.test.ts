import { describe, expect, it } from 'vitest'
import type { IncomingMessage, ServerResponse } from 'node:http'
import { createAuth } from './auth.ts'

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

describe('createAuth disabled (no token configured)', () => {
  it('authorizes everything and never matches a login attempt', () => {
    const auth = createAuth(undefined)
    expect(auth.enabled).toBe(false)
    expect(auth.isAuthorized(req())).toBe(true)
    expect(auth.tokenMatches('anything')).toBe(false)

    expect(createAuth('').enabled).toBe(false)
  })
})

describe('createAuth enabled', () => {
  const auth = createAuth('sekrit')

  it('accepts the exact bearer token and rejects wrong or differently-sized ones', () => {
    expect(auth.isAuthorized(req({ authorization: 'Bearer sekrit' }))).toBe(true)
    expect(auth.isAuthorized(req({ authorization: 'Bearer sekri' }))).toBe(false)
    expect(auth.isAuthorized(req({ authorization: 'Bearer sekrit-and-then-some' }))).toBe(false)
    expect(auth.isAuthorized(req({ authorization: 'Basic sekrit' }))).toBe(false)
    expect(auth.isAuthorized(req())).toBe(false)
  })

  it('accepts the session cookie its own login flow sets, among other cookies', () => {
    const r = res()
    auth.setSessionCookie(r)
    const cookie = r.cookies[0]!
    expect(cookie).toContain('HttpOnly')
    expect(cookie).toContain('SameSite=Strict')

    const value = cookie.split(';')[0]! // "cf_session=<hmac>"
    expect(auth.isAuthorized(req({ cookie: `theme=dark; ${value}; other=1` }))).toBe(true)
    expect(auth.isAuthorized(req({ cookie: 'cf_session=wrong' }))).toBe(false)
  })

  it('rotating the token invalidates previously-issued cookies', () => {
    const r = res()
    auth.setSessionCookie(r)
    const oldCookie = r.cookies[0]!.split(';')[0]!

    const rotated = createAuth('sekrit-2')
    expect(rotated.isAuthorized(req({ cookie: oldCookie }))).toBe(false)
  })

  it('clearSessionCookie expires the cookie immediately', () => {
    const r = res()
    auth.clearSessionCookie(r)
    expect(r.cookies[0]).toContain('Max-Age=0')
  })

  it('matches login tokens timing-safely regardless of length', () => {
    expect(auth.tokenMatches('sekrit')).toBe(true)
    expect(auth.tokenMatches('nope')).toBe(false)
    expect(auth.tokenMatches('')).toBe(false)
  })
})
