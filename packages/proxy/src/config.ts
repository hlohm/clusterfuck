import { readFileSync, renameSync, writeFileSync } from 'node:fs'
import type { NodeConfig } from './syncthing/client.ts'

interface RawConfigFile {
  nodes: { id: string; url: string; apiKey: string }[]
}

/** Resolves the cluster config path once so load/save always agree on the same file. */
function configPath(path?: string): string {
  return path ?? process.env.CLUSTERFUCK_CONFIG ?? './cluster.json'
}

/**
 * Loads the node registry from the cluster config file — the app's one
 * source of truth for which Syncthing nodes it manages. Read at startup and
 * kept in sync with runtime node registrations via saveNodeConfig() below.
 * Path defaults to ./cluster.json, overridable via CLUSTERFUCK_CONFIG so
 * deployments can point elsewhere without editing code.
 */
export function loadNodeConfig(path = configPath()): NodeConfig[] {
  let raw: string
  try {
    raw = readFileSync(path, 'utf-8')
  } catch (err) {
    throw new Error(
      `Could not read node config at ${path}. Copy cluster.example.json to ${path} and fill in ` +
        `your nodes, or set CLUSTERFUCK_CONFIG to point elsewhere. (${(err as Error).message})`,
    )
  }

  const parsed = JSON.parse(raw) as RawConfigFile
  if (!Array.isArray(parsed.nodes)) {
    throw new Error(`${path} must contain a "nodes" array`)
  }
  // An empty array is a valid, if degenerate, state — not just at first
  // install (before any node is registered through the UI) but reachable at
  // any time by removing every registered node. Rejecting it here would
  // mean removeNode() could persist a config the proxy can no longer start
  // back up with.
  const seen = new Set<string>()
  for (const node of parsed.nodes) {
    if (!node.id || !node.url || !node.apiKey) {
      throw new Error(`${path}: every node needs id, url, and apiKey — got ${JSON.stringify(node)}`)
    }
    // Duplicate ids would silently collide at runtime (snapshots and node
    // lookups are keyed by id) — reject at startup like addNode() does for
    // runtime registration.
    if (seen.has(node.id)) {
      throw new Error(`${path}: duplicate node id "${node.id}" — every node needs a unique id`)
    }
    seen.add(node.id)
  }

  return parsed.nodes
}

/**
 * Persists the current node registry back to the cluster config file —
 * called after every runtime add/remove (see ClusterStateManager.addNode/
 * removeNode) so the file stays the single source of truth and the next
 * startup picks up exactly what's registered now. Writes to a temp file
 * first, then renames over the target (atomic on the same filesystem), so a
 * crash mid-write can't leave a corrupted config behind.
 */
export function saveNodeConfig(nodes: NodeConfig[], path = configPath()): void {
  const tmpPath = `${path}.tmp`
  writeFileSync(tmpPath, JSON.stringify({ nodes }, null, 2) + '\n', 'utf-8')
  renameSync(tmpPath, path)
}
