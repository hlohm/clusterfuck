import { call, callJson, getJson } from './http'

/**
 * The proxy's auth handshake (see packages/proxy/src/auth.ts): one shared
 * token, exchanged once per browser for an HttpOnly session cookie. Rides
 * the shared http helpers, so the global 401 hook (session expiry → back to
 * the login screen) covers these calls too.
 */

export interface AuthStatus {
  /** Whether this proxy has a token configured at all. */
  required: boolean
  /** Whether this browser's cookie (or header) currently passes. */
  authorized: boolean
  /** Token comes from CLUSTERFUCK_TOKEN — the GUI can't change it. */
  managedByEnv: boolean
}

export function getAuthStatus(): Promise<AuthStatus> {
  return getJson('/api/auth')
}

/**
 * Initialises or rotates the token. Omit `token` to have the proxy generate a
 * strong one; the response carries the now-current token to display. Also
 * signs the caller in via the fresh cookie in the response.
 */
export function setAuthToken(token?: string): Promise<string> {
  return callJson<{ token: string }>('PUT', '/api/auth/token', token !== undefined ? { token } : {}).then(
    (res) => res.token,
  )
}

/** Exchanges the token for the session cookie. Rejects with the proxy's error on a wrong token. */
export function login(token: string): Promise<void> {
  return call('POST', '/api/login', { token })
}

export function logout(): Promise<void> {
  return call('POST', '/api/logout')
}

/** The configured token, for the authorized-only GUI reveal ("sign in elsewhere with this"). */
export function getToken(): Promise<string> {
  return getJson<{ token: string }>('/api/auth/token').then((res) => res.token)
}
