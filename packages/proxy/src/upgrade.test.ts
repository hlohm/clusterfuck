import { describe, expect, it, vi } from 'vitest'
import { executeUpgradeRun, newUpgradeRun, type UpgradeClient, type UpgradeTarget } from './upgrade.ts'

const OPTS = { pollMs: 1, timeoutMs: 50 }

function target(deviceId: string, client: Partial<UpgradeClient>): UpgradeTarget {
  return {
    deviceId,
    client: {
      upgradeCheck: vi.fn().mockResolvedValue({ running: 'v1.0.0', latest: 'v1.0.0', newer: false, majorNewer: false }),
      upgradePerform: vi.fn().mockResolvedValue(undefined),
      systemVersion: vi.fn().mockResolvedValue({ version: 'v1.0.0' }),
      ...client,
    },
  }
}

describe('executeUpgradeRun', () => {
  it('upgrades only nodes with a newer release, one at a time, and health-checks each back', async () => {
    const order: string[] = []
    const a = target('A', {
      upgradeCheck: vi.fn(async () => {
        order.push('check A')
        return { running: 'v1.1.0', latest: 'v1.1.0', newer: false, majorNewer: false }
      }),
    })
    const b = target('B', {
      upgradeCheck: vi.fn(async () => {
        order.push('check B')
        return { running: 'v1.0.0', latest: 'v1.1.0', newer: true, majorNewer: false }
      }),
      upgradePerform: vi.fn(async () => {
        order.push('perform B')
      }),
      systemVersion: vi.fn(async () => {
        order.push('probe B')
        return { version: 'v1.1.0' }
      }),
    })

    const run = newUpgradeRun([a, b])
    await executeUpgradeRun(run, [a, b], OPTS)

    expect(run.nodes[0]).toMatchObject({ nodeId: 'A', status: 'up-to-date', fromVersion: 'v1.1.0' })
    expect(run.nodes[1]).toMatchObject({
      nodeId: 'B',
      status: 'done',
      fromVersion: 'v1.0.0',
      toVersion: 'v1.1.0',
    })
    expect(run.running).toBe(false)
    expect(run.aborted).toBe(false)
    expect(a.client.upgradePerform).not.toHaveBeenCalled()
    // Strict sequencing: A fully resolved before B was touched.
    expect(order.slice(0, 2)).toEqual(['check A', 'check B'])
  })

  it('reports a major-only upgrade and skips it without aborting the sweep', async () => {
    // A 1.x node whose only available upgrade is 2.x: never installed by a
    // normal sweep — and NOT a failure, so the sweep continues past it.
    const a = target('A', {
      upgradeCheck: vi
        .fn()
        .mockResolvedValue({ running: 'v1.29.2', latest: 'v2.0.4', newer: true, majorNewer: true }),
    })
    const b = target('B', {
      upgradeCheck: vi
        .fn()
        .mockResolvedValue({ running: 'v1.0.0', latest: 'v1.1.0', newer: true, majorNewer: false }),
      systemVersion: vi.fn().mockResolvedValue({ version: 'v1.1.0' }),
    })

    const run = newUpgradeRun([a, b])
    await executeUpgradeRun(run, [a, b], OPTS)

    expect(run.nodes[0]).toMatchObject({
      nodeId: 'A',
      status: 'major-available',
      fromVersion: 'v1.29.2',
      toVersion: 'v2.0.4',
    })
    expect(a.client.upgradePerform).not.toHaveBeenCalled()
    expect(run.nodes[1]!.status).toBe('done')
    expect(run.aborted).toBe(false)
  })

  it('crosses the major when the run was started with includeMajor', async () => {
    const a = target('A', {
      upgradeCheck: vi
        .fn()
        .mockResolvedValue({ running: 'v1.29.2', latest: 'v2.0.4', newer: true, majorNewer: true }),
      systemVersion: vi.fn().mockResolvedValue({ version: 'v2.0.4' }),
    })

    const run = newUpgradeRun([a])
    await executeUpgradeRun(run, [a], { ...OPTS, includeMajor: true })

    expect(a.client.upgradePerform).toHaveBeenCalled()
    expect(run.nodes[0]).toMatchObject({ nodeId: 'A', status: 'done', toVersion: 'v2.0.4' })
  })

  it('tolerates the connection dropping while the upgrade restarts the node', async () => {
    const a = target('A', {
      upgradeCheck: vi.fn().mockResolvedValue({ running: 'v1.0.0', latest: 'v1.1.0', newer: true, majorNewer: false }),
      upgradePerform: vi.fn().mockRejectedValue(new Error('st-a: POST /rest/system/upgrade -> connection failed')),
      systemVersion: vi.fn().mockResolvedValue({ version: 'v1.1.0' }),
    })

    const run = newUpgradeRun([a])
    await executeUpgradeRun(run, [a], OPTS)

    expect(run.nodes[0]!.status).toBe('done')
    expect(run.nodes[0]!.toVersion).toBe('v1.1.0')
  })

  it('fails a node that never comes back, and skips the rest instead of marching on', async () => {
    const a = target('A', {
      upgradeCheck: vi.fn().mockResolvedValue({ running: 'v1.0.0', latest: 'v1.1.0', newer: true, majorNewer: false }),
      systemVersion: vi.fn().mockRejectedValue(new Error('connection failed')),
    })
    const b = target('B', {})

    const run = newUpgradeRun([a, b])
    await executeUpgradeRun(run, [a, b], OPTS)

    expect(run.nodes[0]!.status).toBe('failed')
    expect(run.nodes[0]!.detail).toContain('did not come back')
    expect(run.nodes[1]!.status).toBe('skipped')
    expect(run.aborted).toBe(true)
    expect(b.client.upgradeCheck).not.toHaveBeenCalled()
  })

  it('treats a real HTTP error from the upgrade call as a failure (not a restart race)', async () => {
    const a = target('A', {
      upgradeCheck: vi.fn().mockResolvedValue({ running: 'v1.0.0', latest: 'v1.1.0', newer: true, majorNewer: false }),
      upgradePerform: vi.fn().mockRejectedValue(new Error('st-a: POST /rest/system/upgrade -> HTTP 500')),
    })

    const run = newUpgradeRun([a])
    await executeUpgradeRun(run, [a], OPTS)

    expect(run.nodes[0]!.status).toBe('failed')
    expect(run.aborted).toBe(true)
  })

  it('fails the run at the check stage when a node is unreachable', async () => {
    const a = target('A', {
      upgradeCheck: vi.fn().mockRejectedValue(new Error('connection failed')),
    })

    const run = newUpgradeRun([a])
    await executeUpgradeRun(run, [a], OPTS)

    expect(run.nodes[0]!.status).toBe('failed')
    expect(run.nodes[0]!.detail).toContain('upgrade check failed')
  })
})
