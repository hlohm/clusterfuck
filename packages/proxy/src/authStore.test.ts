import { afterEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, statSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadAuthToken, saveAuthToken } from './authStore.ts'

function tmpFile(): string {
  return join(mkdtempSync(join(tmpdir(), 'cf-auth-')), 'auth.json')
}

const savedEnv = process.env.CLUSTERFUCK_TOKEN
afterEach(() => {
  if (savedEnv === undefined) delete process.env.CLUSTERFUCK_TOKEN
  else process.env.CLUSTERFUCK_TOKEN = savedEnv
})

describe('loadAuthToken precedence', () => {
  it('takes the env var first and marks it env-managed', () => {
    process.env.CLUSTERFUCK_TOKEN = 'env-token'
    const path = tmpFile()
    saveAuthToken('file-token', path)

    expect(loadAuthToken(path)).toEqual({ token: 'env-token', managedByEnv: true })
  })

  it('falls back to the file when no env var is set', () => {
    delete process.env.CLUSTERFUCK_TOKEN
    const path = tmpFile()
    saveAuthToken('file-token', path)

    expect(loadAuthToken(path)).toEqual({ token: 'file-token', managedByEnv: false })
  })

  it('reports no token (open) when neither env nor a readable file exists', () => {
    delete process.env.CLUSTERFUCK_TOKEN
    expect(loadAuthToken(join(tmpdir(), 'does-not-exist-cf-auth.json'))).toEqual({ managedByEnv: false })
  })

  it('treats a malformed or empty-token file as open, not a crash', () => {
    delete process.env.CLUSTERFUCK_TOKEN
    const path = tmpFile()
    writeFileSync(path, '{ not valid json')
    expect(loadAuthToken(path)).toEqual({ managedByEnv: false })

    writeFileSync(path, JSON.stringify({ token: '' }))
    expect(loadAuthToken(path)).toEqual({ managedByEnv: false })
  })
})

describe('saveAuthToken', () => {
  afterEach(() => undefined)

  it('round-trips a token and writes the file 0600', () => {
    delete process.env.CLUSTERFUCK_TOKEN
    const path = tmpFile()
    saveAuthToken('a-persisted-token', path)

    expect(loadAuthToken(path)).toEqual({ token: 'a-persisted-token', managedByEnv: false })
    // Owner-only permissions on the secret file (low 9 bits).
    expect(statSync(path).mode & 0o777).toBe(0o600)
    expect(JSON.parse(readFileSync(path, 'utf-8'))).toEqual({ token: 'a-persisted-token' })
  })

  it('cleans up: the temp file is renamed away, not left behind', () => {
    const path = tmpFile()
    saveAuthToken('another-token', path)
    expect(() => statSync(`${path}.tmp`)).toThrow()
  })
})
