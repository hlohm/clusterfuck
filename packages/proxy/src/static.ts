import { existsSync, statSync } from 'node:fs'
import { readFile } from 'node:fs/promises'
import { extname, join, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

/**
 * Static serving for the built SPA, so production is one process on one
 * origin (same-origin cookies, no CORS). Reads are async — this event loop
 * also fans out SSE frames and proxies mutations, and a synchronous
 * whole-file read would stall all of it.
 */

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.json': 'application/json',
  '.map': 'application/json',
  '.woff2': 'font/woff2',
  '.txt': 'text/plain; charset=utf-8',
}

export type StaticHandler = (pathname: string, res: ServerResponse) => Promise<boolean>

/**
 * Returns a handler that serves `pathname` from `rootDir`, or undefined when
 * the directory doesn't exist (dev without a web build — the caller keeps
 * the plain-404 behavior). Rules:
 * - malformed percent-encoding or a path resolving outside the root → not
 *   served (the caller 404s), never a thrown 500;
 * - a missing path WITH an extension (e.g. a stale hashed asset after a
 *   redeploy) → not served: a hard 404 the browser can diagnose, instead of
 *   index.html masquerading as JavaScript;
 * - a missing extensionless path → index.html (SPA fallback);
 * - Vite's content-hashed /assets/* are immutable and cached hard;
 *   index.html itself always revalidates so deploys take effect.
 */
export function createStaticHandler(rootDir: string): StaticHandler | undefined {
  const root = resolve(rootDir)
  if (!existsSync(join(root, 'index.html'))) return undefined

  return async (pathname, res) => {
    let decoded: string
    try {
      decoded = decodeURIComponent(pathname)
    } catch {
      return false // malformed percent-encoding (e.g. GET /%) — a 404, not a crash
    }
    let filePath = resolve(join(root, decoded))
    // resolve() collapses any ../ — a path escaping the root lands outside it.
    if (filePath !== root && !filePath.startsWith(root + sep)) return false

    // One stat covers existence and kind, atomically (no exists-then-stat race).
    const stat = statSync(filePath, { throwIfNoEntry: false })
    if (stat === undefined || stat.isDirectory()) {
      if (extname(decoded) !== '') return false // stale/missing real file: hard 404
      filePath = join(root, 'index.html')
    }

    const body = await readFile(filePath)
    const immutableAsset = decoded.startsWith('/assets/') && extname(filePath) !== '.html'
    res.writeHead(200, {
      'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream',
      // Hashed asset names make their content immutable; index.html (and
      // anything unhashed) must revalidate so a redeploy takes effect.
      'Cache-Control': immutableAsset ? 'public, max-age=31536000, immutable' : 'no-cache',
    })
    res.end(body)
    return true
  }
}
