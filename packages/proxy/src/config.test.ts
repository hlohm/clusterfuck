import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadNodeConfig, saveNodeConfig } from './config.ts'

describe('loadNodeConfig / saveNodeConfig', () => {
  let dir: string
  let configFile: string

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), 'clusterfuck-config-test-'))
    configFile = join(dir, 'cluster.json')
  })

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true })
  })

  it('loads a well-formed config', () => {
    writeFileSync(
      configFile,
      JSON.stringify({
        nodes: [{ id: 'st-a', url: 'http://127.0.0.1:8384', apiKey: 'key-a' }],
      }),
    )

    expect(loadNodeConfig(configFile)).toEqual([
      { id: 'st-a', url: 'http://127.0.0.1:8384', apiKey: 'key-a' },
    ])
  })

  it('starts with an empty registry when the file is missing — the packaged-install first run', () => {
    // A fresh Docker volume or unpacked tarball has no cluster.json yet;
    // the Register-node UI bootstraps it (the first registration writes
    // the file). Dying here would crash-loop every packaged install.
    expect(loadNodeConfig(join(dir, 'does-not-exist.json'))).toEqual([])
  })

  it('still fails loudly when the config path exists but cannot be read as a file', () => {
    // Not ENOENT: a directory in the way is a real misconfiguration, not a
    // first run.
    expect(() => loadNodeConfig(dir)).toThrow(/Could not read node config/)
  })

  it('rejects a missing or non-array nodes field', () => {
    writeFileSync(configFile, JSON.stringify({}))
    expect(() => loadNodeConfig(configFile)).toThrow(/must contain a "nodes" array/)

    writeFileSync(configFile, JSON.stringify({ nodes: 'not-an-array' }))
    expect(() => loadNodeConfig(configFile)).toThrow(/must contain a "nodes" array/)
  })

  it('accepts an empty nodes array — reachable at runtime by removing every registered node', () => {
    writeFileSync(configFile, JSON.stringify({ nodes: [] }))
    expect(loadNodeConfig(configFile)).toEqual([])
  })

  it('rejects a node missing id, url, or apiKey', () => {
    writeFileSync(configFile, JSON.stringify({ nodes: [{ id: 'st-a', url: 'http://x' }] }))
    expect(() => loadNodeConfig(configFile)).toThrow(/every node needs id, url, and apiKey/)
  })

  it('rejects duplicate node ids — they would silently collide in runtime lookups keyed by id', () => {
    writeFileSync(
      configFile,
      JSON.stringify({
        nodes: [
          { id: 'st-a', url: 'http://a', apiKey: 'ka' },
          { id: 'st-a', url: 'http://b', apiKey: 'kb' },
        ],
      }),
    )
    expect(() => loadNodeConfig(configFile)).toThrow(/duplicate node id "st-a"/)
  })

  it('saveNodeConfig writes a file loadNodeConfig can read back unchanged (round-trip)', () => {
    const nodes = [
      { id: 'st-a', url: 'http://127.0.0.1:8384', apiKey: 'key-a' },
      { id: 'st-b', url: 'http://127.0.0.1:8385', apiKey: 'key-b' },
    ]

    saveNodeConfig(nodes, configFile)

    expect(loadNodeConfig(configFile)).toEqual(nodes)
  })

  it('saveNodeConfig overwrites a previous config entirely, not merges it', () => {
    saveNodeConfig([{ id: 'st-a', url: 'http://a', apiKey: 'ka' }], configFile)
    saveNodeConfig([{ id: 'st-b', url: 'http://b', apiKey: 'kb' }], configFile)

    expect(loadNodeConfig(configFile)).toEqual([{ id: 'st-b', url: 'http://b', apiKey: 'kb' }])
  })

  it('writes via a temp file and renames over the target, leaving no .tmp file behind on success', () => {
    saveNodeConfig([{ id: 'st-a', url: 'http://a', apiKey: 'ka' }], configFile)

    expect(() => readFileSync(`${configFile}.tmp`, 'utf-8')).toThrow()
    expect(readFileSync(configFile, 'utf-8')).toContain('st-a')
  })

  // Regression: removeNode() can drive the registry down to zero nodes and
  // persists that via saveNodeConfig([]) — loadNodeConfig used to reject an
  // empty array, which would have crashed the proxy on its very next
  // restart (index.ts calls loadNodeConfig() unguarded at module scope).
  it('a config saved after removing the last node can still be loaded on the next startup', () => {
    saveNodeConfig([], configFile)

    expect(loadNodeConfig(configFile)).toEqual([])
  })
})
