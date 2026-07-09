import { existsSync, readFileSync, statSync } from 'node:fs'
import { extname, join, resolve, sep } from 'node:path'
import type { ServerResponse } from 'node:http'

/**
 * Static serving for the built SPA, so production is one process on one
 * origin (same-origin cookies, no CORS). Deliberately tiny: whole-file reads,
 * no caching headers beyond letting the hashed asset names do their job.
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

export type StaticHandler = (pathname: string, res: ServerResponse) => boolean

/**
 * Returns a handler that serves `pathname` from `rootDir`, or undefined when
 * the directory doesn't exist (dev without a web build — the caller keeps
 * today's plain 404 behavior). Unknown paths fall back to index.html (SPA
 * routing); anything resolving outside the root is refused.
 */
export function createStaticHandler(rootDir: string): StaticHandler | undefined {
  const root = resolve(rootDir)
  if (!existsSync(join(root, 'index.html'))) return undefined

  return (pathname, res) => {
    const decoded = decodeURIComponent(pathname)
    let filePath = resolve(join(root, decoded))
    // resolve() collapses any ../ — a path escaping the root lands outside it.
    if (filePath !== root && !filePath.startsWith(root + sep)) return false
    if (!existsSync(filePath) || statSync(filePath).isDirectory()) {
      filePath = join(root, 'index.html')
    }
    const body = readFileSync(filePath)
    res.writeHead(200, { 'Content-Type': MIME[extname(filePath)] ?? 'application/octet-stream' })
    res.end(body)
    return true
  }
}
