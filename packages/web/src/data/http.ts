import { PROXY_BASE } from './proxyBase'

/**
 * The one fetch layer every proxy call goes through (mutations.ts and
 * auth.ts both build on it). Centralized so cross-cutting behavior exists
 * exactly once: `credentials: 'include'` (carries the auth session cookie on
 * a cross-origin proxy; a no-op same-origin), `{error}` extraction from the
 * proxy's JSON error bodies, and the 401 hook below.
 */

let onUnauthorized: (() => void) | undefined

/**
 * Called (at most once per request) whenever the proxy answers 401 — i.e.
 * this browser's session expired or the token was rotated. App.tsx registers
 * a listener that flips the UI back to the login screen; without it a
 * de-authed tab would just show cryptic inline errors until a manual reload.
 */
export function setUnauthorizedListener(fn: (() => void) | undefined): void {
  onUnauthorized = fn
}

/** For callers that detect de-auth out of band (the SSE stream can't see HTTP statuses). */
export function notifyUnauthorized(): void {
  onUnauthorized?.()
}

async function handleFailure(method: string, path: string, res: Response): Promise<never> {
  if (res.status === 401) onUnauthorized?.()
  const data = (await res.json().catch(() => undefined)) as { error?: string } | undefined
  throw new Error(data?.error ?? `${method} ${path} failed (HTTP ${res.status})`)
}

export async function call(method: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) await handleFailure(method, path, res)
}

/** GET variant of `call` for the routes that return data, not just `{ ok }`. */
export async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, { credentials: 'include' })
  if (!res.ok) await handleFailure('GET', path, res)
  return (await res.json()) as T
}
