import { readFileSync } from 'node:fs'

/**
 * Read directly from package.json rather than a hardcoded constant, so the
 * version reported by a running process always matches what was actually
 * deployed — the fastest way to tell a stale process apart from a fresh one
 * (see the "no route matched" log in server.ts for the other half of this).
 */
export const PROXY_VERSION: string = (
  JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
    version: string
  }
).version
