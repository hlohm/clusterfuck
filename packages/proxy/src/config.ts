import { readFileSync } from 'node:fs'
import type { NodeConfig } from './syncthing/client.ts'

interface RawConfigFile {
  nodes: { id: string; url: string; apiKey: string }[]
}

/**
 * Loads the node registry from a static, untracked JSON config file (Phase 2
 * decision: static config file, not an in-app registration UI — see
 * CLAUDE.md). Path defaults to ./dev-cluster.json, overridable via
 * CLUSTERFUCK_CONFIG so deployments can point elsewhere without editing code.
 */
export function loadNodeConfig(path = process.env.CLUSTERFUCK_CONFIG ?? './dev-cluster.json'): NodeConfig[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    throw new Error(
      `Could not read node config at ${path}. Copy dev-cluster.example.json to ${path} and fill in ` +
        `your nodes, or set CLUSTERFUCK_CONFIG to point elsewhere. (${(err as Error).message})`,
    )
  }

  const parsed = JSON.parse(raw) as RawConfigFile
  if (!Array.isArray(parsed.nodes) || parsed.nodes.length === 0) {
    throw new Error(`${path} must contain a non-empty "nodes" array`)
  }
  for (const node of parsed.nodes) {
    if (!node.id || !node.url || !node.apiKey) {
      throw new Error(`${path}: every node needs id, url, and apiKey — got ${JSON.stringify(node)}`)
    }
  }

  return parsed.nodes
}
