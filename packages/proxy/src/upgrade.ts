import type { UpgradeRun } from '@clusterfuck/shared'
import type { SystemVersionResponse, UpgradeCheckResponse } from './syncthing/types.ts'

/**
 * Upgrade orchestration (ROADMAP.md Phase 5 Cluster operations): every
 * registered node, strictly one at a time, each health-checked back to
 * reachability before the next starts — so at most one node is ever
 * mid-upgrade, and a failure aborts the sweep instead of marching on.
 */

/** The slice of SyncthingClient this needs — an interface so tests can drive the runner with plain fakes. */
export interface UpgradeClient {
  upgradeCheck(): Promise<UpgradeCheckResponse>
  upgradePerform(): Promise<void>
  systemVersion(): Promise<SystemVersionResponse>
}

export interface UpgradeTarget {
  /** The registered node's own device ID. */
  deviceId: string
  client: UpgradeClient
}

export interface UpgradeRunOpts {
  /** How often to probe an upgrading node for liveness. */
  pollMs: number
  /** How long a node may stay unreachable mid-upgrade before the run fails and aborts. */
  timeoutMs: number
  /**
   * Install across a major version boundary (e.g. 1.x → 2.x). Off by
   * default: a major upgrade changes behavior (2.0 migrates the database on
   * first launch, which can be lengthy) and must be a deliberate,
   * separately-confirmed choice — mirroring Syncthing's own GUI, which
   * treats major upgrades specially rather than auto-applying them.
   */
  includeMajor?: boolean
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

export function newUpgradeRun(targets: UpgradeTarget[]): UpgradeRun {
  return {
    running: true,
    aborted: false,
    startedAt: new Date().toISOString(),
    nodes: targets.map((t) => ({ nodeId: t.deviceId, status: 'pending' as const })),
  }
}

/**
 * Executes the sweep, mutating `run` in place as it goes (the owner serves
 * the same object to pollers, so progress is visible live). Never rejects:
 * every failure lands in a node's status and aborts the remainder.
 */
export async function executeUpgradeRun(
  run: UpgradeRun,
  targets: UpgradeTarget[],
  opts: UpgradeRunOpts,
): Promise<void> {
  let abort = false
  for (const [i, target] of targets.entries()) {
    const node = run.nodes[i]!
    if (abort) {
      node.status = 'skipped'
      node.detail = 'not attempted — an earlier node failed'
      continue
    }

    node.status = 'checking'
    let check
    try {
      check = await target.client.upgradeCheck()
    } catch (err) {
      node.status = 'failed'
      node.detail = `upgrade check failed: ${(err as Error).message}`
      abort = true
      continue
    }
    node.fromVersion = check.running

    // The major gate comes first: when `latest` crosses a major boundary,
    // "up to date within its major" and "newer available" both collapse into
    // the same truth — a major is available and a normal sweep won't touch
    // it. Skipping is not a failure; the sweep continues with the next node.
    if (check.majorNewer && opts.includeMajor !== true) {
      node.status = 'major-available'
      node.toVersion = check.latest
      node.detail = `${check.latest} is a major upgrade — excluded from a normal sweep`
      continue
    }

    if (!check.newer && !check.majorNewer) {
      node.status = 'up-to-date'
      continue
    }

    node.status = 'upgrading'
    node.toVersion = check.latest
    node.detail = `installing ${check.latest}`
    try {
      await target.client.upgradePerform()
    } catch (err) {
      // Like restart: Syncthing acks and exits, and the connection can drop
      // before the response gets out — only a real (HTTP) error is a failure.
      if (!/connection failed/.test((err as Error).message)) {
        node.status = 'failed'
        node.detail = `upgrade failed: ${(err as Error).message}`
        abort = true
        continue
      }
    }

    // Health check: the node must come back before the next one starts.
    node.detail = 'waiting for the node to come back'
    const deadline = Date.now() + opts.timeoutMs
    let backVersion: string | undefined
    while (Date.now() < deadline) {
      await sleep(opts.pollMs)
      try {
        backVersion = (await target.client.systemVersion()).version
        break
      } catch {
        // still restarting — keep waiting
      }
    }
    if (backVersion === undefined) {
      node.status = 'failed'
      node.detail = `did not come back within ${Math.round(opts.timeoutMs / 1000)}s of upgrading`
      abort = true
      continue
    }
    node.status = 'done'
    node.toVersion = backVersion
    node.detail = undefined
  }

  run.running = false
  run.aborted = abort
  run.finishedAt = new Date().toISOString()
}
