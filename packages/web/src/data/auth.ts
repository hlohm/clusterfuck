import { PROXY_BASE } from './proxyBase'

/**
 * The proxy's auth handshake (see packages/proxy/src/auth.ts): one shared
 * token, exchanged once per browser for an HttpOnly session cookie. All
 * requests ride `credentials: 'include'` so the cookie flows even when the
 * proxy is on another origin (a no-op same-origin).
 */

export interface AuthStatus {
  /** Whether this proxy has a token configured at all. */
  required: boolean
  /** Whether this browser's cookie (or header) currently passes. */
  authorized: boolean
}

export function getAuthStatus(): Promise<AuthStatus> {
  return getJson('/api/auth')
}

/** Exchanges the token for the session cookie. Rejects with the proxy's error on a wrong token. */
export function login(token: string): Promise<void> {
  return post('/api/login', { token })
}

export function logout(): Promise<void> {
  return post('/api/logout')
}

/** The configured token, for the authorized-only GUI reveal ("sign in elsewhere with this"). */
export function getToken(): Promise<string> {
  return getJson<{ token: string }>('/api/auth/token').then((res) => res.token)
}

async function post(path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method: 'POST',
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    throw new Error(data?.error ?? `POST ${path} failed (HTTP ${res.status})`)
  }
}

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, { credentials: 'include' })
  if (!res.ok) {
    const data = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    throw new Error(data?.error ?? `GET ${path} failed (HTTP ${res.status})`)
  }
  return (await res.json()) as T
}
