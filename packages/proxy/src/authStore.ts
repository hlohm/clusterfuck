import { readFileSync, renameSync, writeFileSync } from 'node:fs'

/**
 * Persistence for the proxy auth token, parallel to config.ts's node
 * registry. The token is stored raw in a gitignored file (same threat model
 * as cluster.json holding raw Syncthing API keys) so the GUI reveal and the
 * HMAC-of-token cookie keep working. Written with mode 0600 — it's the
 * master secret.
 */

interface RawAuthFile {
  token?: string
}

export interface LoadedAuth {
  token?: string
  /** True when the token came from CLUSTERFUCK_TOKEN — authoritative, GUI read-only. */
  managedByEnv: boolean
}

function authPath(path?: string): string {
  return path ?? process.env.CLUSTERFUCK_AUTH_CONFIG ?? './auth.json'
}

/**
 * Resolves the initial token and who owns it. Precedence:
 * 1. `CLUSTERFUCK_TOKEN` env var → authoritative (managedByEnv), file ignored.
 * 2. the auth file, if present and non-empty.
 * 3. nothing → the proxy runs open.
 * A missing/unreadable/malformed file is treated as "no token" (open), not a
 * fatal error — the GUI can then initialise auth.
 */
export function loadAuthToken(path = authPath()): LoadedAuth {
  const envToken = process.env.CLUSTERFUCK_TOKEN
  if (envToken !== undefined && envToken !== '') {
    return { token: envToken, managedByEnv: true }
  }
  try {
    const parsed = JSON.parse(readFileSync(path, 'utf-8')) as RawAuthFile
    const token = typeof parsed.token === 'string' && parsed.token !== '' ? parsed.token : undefined
    return { token, managedByEnv: false }
  } catch {
    return { managedByEnv: false }
  }
}

/**
 * Persists a set/rotated token. Atomic (temp-write + rename, like
 * saveNodeConfig) so a crash mid-write can't corrupt it, and mode 0600 so
 * it's not world-readable. Only ever called for non-env-managed tokens.
 */
export function saveAuthToken(token: string, path = authPath()): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify({ token }, null, 2) + '\n', { mode: 0o600 })
  renameSync(tmpPath, path)
}
