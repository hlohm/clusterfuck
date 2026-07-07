import type { ClusterModel, DeviceId, FolderId, FolderVersioning, Share } from './types.ts'

/**
 * Config drift detection — the genuinely cluster-level check a single-node
 * GUI cannot do (ROADMAP.md Phase 5, Cluster operations). Pure functions over
 * the ClusterModel: every input is first-hand data from managed nodes, so a
 * finding is a real disagreement between nodes' own configs, never a guess
 * about an unmanaged peer.
 *
 * Deliberately NOT flagged: pairwise folder-type differences (sendonly next
 * to receiveonly is a normal, intentional topology) and per-node ignore
 * patterns (they have their own differ indicator, fetched on demand).
 */

export type DriftKind = 'label' | 'versioning' | 'no-writer' | 'no-reader' | 'asymmetric-share' | 'missing-folder'

export interface DriftFinding {
  kind: DriftKind
  folderId: FolderId
  /** warning = probably broken; info = legal but worth knowing (e.g. versioning differs). */
  severity: 'info' | 'warning'
  /** What disagrees, with the disagreeing values/devices spelled out (device *names*, for display). */
  message: string
  /** A concrete way to resolve it — advisory text, not an auto-applied action. */
  suggestion: string
  /** The devices involved, so the UI can deep-link. */
  deviceIds: DeviceId[]
}

interface DriftContext {
  nameFor: (id: DeviceId) => string
  managedIds: Set<DeviceId>
}

const SEVERITY_ORDER: Record<DriftFinding['severity'], number> = { warning: 0, info: 1 }

/** All drift findings for the cluster, warnings first, in stable folder order. */
export function detectDrift(cluster: ClusterModel): DriftFinding[] {
  const names = new Map(cluster.devices.map((d) => [d.id, d.name]))
  const ctx: DriftContext = {
    nameFor: (id) => names.get(id) ?? id,
    managedIds: new Set(cluster.devices.filter((d) => d.managed).map((d) => d.id)),
  }

  const findings: DriftFinding[] = []
  for (const folder of cluster.folders) {
    const shares = cluster.shares.filter((s) => s.folderId === folder.id)
    if (shares.length === 0) continue
    findings.push(
      ...labelDrift(folder.id, folder.label, shares, ctx),
      ...versioningDrift(folder.id, shares),
      ...typePathologies(folder.id, shares),
      ...asymmetricShares(folder.id, shares, ctx),
    )
  }
  return findings.sort((a, b) => SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity])
}

/** A share with no label of its own agrees with the folder's representative label by definition. */
function labelDrift(
  folderId: FolderId,
  folderLabel: string,
  shares: Share[],
  ctx: DriftContext,
): DriftFinding[] {
  const byLabel = new Map<string, DeviceId[]>()
  for (const share of shares) {
    const label = share.label ?? folderLabel
    byLabel.set(label, [...(byLabel.get(label) ?? []), share.deviceId])
  }
  if (byLabel.size < 2) return []

  const entries = [...byLabel.entries()].sort((a, b) => b[1].length - a[1].length)
  const [majorityLabel, majorityDevices] = entries[0]!
  const outliers = entries.slice(1).flatMap(([, devices]) => devices)
  return [
    {
      kind: 'label',
      folderId,
      severity: 'info',
      message: `Folder is labeled differently across nodes: ${entries
        .map(([label, devices]) => `“${label}” (${devices.map(ctx.nameFor).join(', ')})`)
        .join(' vs ')}`,
      suggestion: `Rename it to “${majorityLabel}” on ${outliers.map(ctx.nameFor).join(', ')}`,
      deviceIds: [...majorityDevices, ...outliers],
    },
  ]
}

function versioningKey(v: FolderVersioning | undefined): string {
  const normalized = v ?? { type: 'none' as const, params: {} }
  return JSON.stringify({
    type: normalized.type,
    params: normalized.params,
    cleanupIntervalS: normalized.cleanupIntervalS,
  })
}

/**
 * Different versioning per node is explicitly supported (each node guards its
 * own copy) — so this is info, not warning: worth knowing, not necessarily
 * wrong.
 */
function versioningDrift(folderId: FolderId, shares: Share[]): DriftFinding[] {
  const byConfig = new Map<string, { devices: DeviceId[]; type: string }>()
  for (const share of shares) {
    const key = versioningKey(share.versioning)
    const entry = byConfig.get(key) ?? { devices: [], type: share.versioning?.type ?? 'none' }
    entry.devices.push(share.deviceId)
    byConfig.set(key, entry)
  }
  if (byConfig.size < 2) return []

  const parts = [...byConfig.values()].map((e) => `${e.type} (${e.devices.length})`)
  return [
    {
      kind: 'versioning',
      folderId,
      severity: 'info',
      message: `File versioning differs across nodes: ${parts.join(', ')}`,
      suggestion: 'Align the versioning config in the folder detail if the difference is unintentional',
      deviceIds: shares.map((s) => s.deviceId),
    },
  ]
}

/**
 * Type mismatches that are actually broken, as opposed to normal asymmetry:
 * with every trusted node sendonly nothing ever accepts a change (permanent
 * out-of-sync), and with every trusted node receiveonly nothing ever sends
 * one (local changes only ever get reverted). Encrypted relays hold
 * ciphertext and are neither writers nor readers here, so they're excluded —
 * and a folder of *only* encrypted copies is pure relay storage, which is
 * fine and yields no finding.
 */
function typePathologies(folderId: FolderId, shares: Share[]): DriftFinding[] {
  const trusted = shares.filter((s) => s.type !== 'receiveencrypted')
  if (trusted.length < 2) return []

  if (trusted.every((s) => s.type === 'sendonly')) {
    return [
      {
        kind: 'no-reader',
        folderId,
        severity: 'warning',
        message: 'Every node is Send Only — each pushes its changes but none ever accepts any',
        suggestion: 'Make at least one node Send & Receive (or Receive Only) so changes have somewhere to land',
        deviceIds: trusted.map((s) => s.deviceId),
      },
    ]
  }
  if (trusted.every((s) => s.type === 'receiveonly')) {
    return [
      {
        kind: 'no-writer',
        folderId,
        severity: 'warning',
        message: 'Every node is Receive Only — no node ever sends a change; local edits only get reverted',
        suggestion: 'Make at least one node Send & Receive (or Send Only) so it can act as the source',
        deviceIds: trusted.map((s) => s.deviceId),
      },
    ]
  }
  return []
}

/**
 * A shares the folder with B, but B — also a managed node, so its config is
 * known first-hand — either doesn't share it back or doesn't have the folder
 * at all (the latter usually means the offer is sitting in B's pending list).
 * Unmanaged peers are skipped: no first-hand view, nothing to compare.
 */
function asymmetricShares(folderId: FolderId, shares: Share[], ctx: DriftContext): DriftFinding[] {
  const byDevice = new Map(shares.map((s) => [s.deviceId, s]))
  const findings: DriftFinding[] = []
  for (const share of shares) {
    const from = ctx.nameFor(share.deviceId)
    for (const target of share.sharedWith) {
      if (target === share.deviceId || !ctx.managedIds.has(target)) continue
      const to = ctx.nameFor(target)
      const back = byDevice.get(target)
      if (back === undefined) {
        findings.push({
          kind: 'missing-folder',
          folderId,
          severity: 'warning',
          message: `${from} shares the folder with ${to}, but ${to} doesn't have the folder at all`,
          suggestion: `Accept the pending folder on ${to} (check the pending inbox), or remove ${to} from the share list on ${from}`,
          deviceIds: [share.deviceId, target],
        })
      } else if (!back.sharedWith.includes(share.deviceId)) {
        findings.push({
          kind: 'asymmetric-share',
          folderId,
          severity: 'warning',
          message: `${from} shares the folder with ${to}, but ${to} doesn't share it back`,
          suggestion: `Add ${from} to the folder's share list on ${to} (or remove ${to} from it on ${from})`,
          deviceIds: [share.deviceId, target],
        })
      }
    }
  }
  return findings
}
