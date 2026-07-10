import { useEffect, useState, type ReactNode } from 'react'
import type {
  BandwidthLimitsView,
  ClusterModel,
  CompletionHistoryView,
  CompletionPoint,
  Device,
  DriftFinding,
  DriftFix,
  EventLogView,
  PendingDevice,
  RecentChangesView,
  Share,
  UpgradeNodeStatus,
  UpgradeRun,
} from '@clusterfuck/shared'
import {
  clusterHealth,
  clusterTransferTotals,
  detectDrift,
  folderHealth,
  folderHealthForDevice,
  sharesByDevice,
  sharesByFolder,
} from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { DEVICE_STATE_STYLE } from '../encoding/deviceStateStyle'
import { STATUS } from '../encoding/colors'
import { cssColor } from '../encoding/colors'
import { StatusBadge } from './StatusBadge'
import { AcceptPendingDeviceDialog, AcceptPendingFolderDialog, type PendingFolderOffer } from './PendingDialogs'
import { useAsyncAction } from '../data/useAsyncAction'
import * as mutations from '../data/mutations'
import * as auth from '../data/auth'
import { CopyButton } from './CopyButton'
import { formatBytes, formatRate } from '../format'
import { loadPref, savePref } from '../data/localPrefs'
import { OverviewSection } from './OverviewSection'
import {
  EMPTY_LAYOUT,
  moveSection,
  normalizeOrder,
  toggleCollapsed,
  type SectionLayout,
} from './sectionLayout'
import { sparklineGeometry } from './sparkline'

export interface OverviewViewProps {
  cluster: ClusterModel
  onOpenShare?: (share: Share) => void
  /** Cluster-wide actions only make sense against the live proxy, never fixtures. */
  isLive?: boolean
}

/**
 * The auth affordances the GUI owes an admin: reveal/copy the shared access
 * token so another browser can sign in (authorized-only route — same stance
 * as Syncthing's GUI showing its API key), and sign this browser out.
 * Renders nothing when the proxy has no auth configured.
 */
function AccessTokenRow() {
  const [required, setRequired] = useState(false)
  const [token, setToken] = useState<string>()
  const [error, setError] = useState<string>()

  useEffect(() => {
    auth
      .getAuthStatus()
      .then((status) => setRequired(status.required))
      .catch(() => setRequired(false))
  }, [])

  if (!required) return null

  return (
    <div className="cluster-actions__row">
      <span className="cluster-actions__label">Access</span>
      <div className="detail-panel__action-row">
        {token === undefined ? (
          <button
            title="Reveal the shared access token — paste it on other browsers/devices to sign in there."
            onClick={() =>
              auth
                .getToken()
                .then(setToken)
                .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
            }
          >
            Show access token
          </button>
        ) : (
          <>
            <code className="access-token">{token}</code>
            <CopyButton text={token} />
            <button className="detail-panel__link-button" onClick={() => setToken(undefined)}>
              Hide
            </button>
          </>
        )}
        <button
          className="detail-panel__link-button"
          onClick={() => {
            // Reload regardless: even if the POST fails (proxy restarting
            // mid-click) the reload re-runs the auth gate, which is the
            // state the user asked for.
            void auth
              .logout()
              .catch(() => undefined)
              .finally(() => window.location.reload())
          }}
        >
          Sign out
        </button>
      </div>
      {error && <div className="detail-panel__error">{error}</div>}
    </div>
  )
}

/** The first cluster-wide (as opposed to per-device/per-folder) mutations — see ROADMAP.md Phase 5. */
function ClusterActions() {
  const { busy, error, run } = useAsyncAction()

  return (
    <article className="folder-card">
        <div className="cluster-actions__body">
          <div className="cluster-actions__row">
            <span className="cluster-actions__label">Devices</span>
            <div className="detail-panel__action-row">
              <button
                className="detail-panel__button--warning"
                disabled={busy}
                onClick={() =>
                  run('Pause every device on every registered node?', () =>
                    mutations.setAllDevicesPaused(true),
                  )
                }
              >
                Pause all
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run('Resume every device on every registered node?', () =>
                    mutations.setAllDevicesPaused(false),
                  )
                }
              >
                Resume all
              </button>
            </div>
          </div>
          <div className="cluster-actions__row">
            <span className="cluster-actions__label">Folders</span>
            <div className="detail-panel__action-row">
              <button
                className="detail-panel__button--warning"
                disabled={busy}
                onClick={() =>
                  run('Pause every folder on every registered node?', () =>
                    mutations.setAllFoldersPaused(true),
                  )
                }
              >
                Pause all
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run('Resume every folder on every registered node?', () =>
                    mutations.setAllFoldersPaused(false),
                  )
                }
              >
                Resume all
              </button>
              <button
                disabled={busy}
                onClick={() =>
                  run('Rescan every folder on every registered node?', () =>
                    mutations.rescanAllFolders(),
                  )
                }
              >
                Rescan all
              </button>
            </div>
          </div>
          <AccessTokenRow />
        </div>
        {error && <div className="detail-panel__error cluster-actions__error">{error}</div>}
    </article>
  )
}

/** KiB/s field: integer >= 0, 0 meaning unlimited — mirrors the proxy's validation. */
function validKbpsField(raw: string): boolean {
  const n = Number(raw)
  return raw.trim() !== '' && Number.isInteger(n) && n >= 0
}

/**
 * Global (whole-node) bandwidth caps, viewed per node and set either on one
 * node or cluster-wide in one action. Loaded on demand — the limits live in
 * each node's /rest/config/options, not in the model. Per-device limits are
 * a different knob (the device detail's options editor).
 */
function BandwidthSection({ cluster }: { cluster: ClusterModel }) {
  const { busy, error, run } = useAsyncAction()
  const [view, setView] = useState<BandwidthLimitsView>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [send, setSend] = useState('0')
  const [recv, setRecv] = useState('0')

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const valid = validKbpsField(send) && validKbpsField(recv)
  const limits = () => ({ maxSendKbps: Number(send), maxRecvKbps: Number(recv) })

  const load = () => {
    setLoading(true)
    setLoadError(undefined)
    mutations
      .getBandwidthLimits()
      .then(setView)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  return (
    <article className="folder-card">
        <div className="cluster-actions__body">
          {!view ? (
            <div className="detail-panel__action-row">
              <button disabled={loading} onClick={load}>
                {loading ? 'Loading…' : 'Load bandwidth limits'}
              </button>
            </div>
          ) : (
            <>
              {view.nodes.map((node) => (
                <div className="cluster-actions__row" key={node.nodeId}>
                  <span className="cluster-actions__label">
                    {deviceById.get(node.nodeId)?.name ?? node.nodeId}
                  </span>
                  {node.error !== undefined ? (
                    <span className="detail-panel__error">{node.error}</span>
                  ) : (
                    <div className="detail-panel__action-row">
                      <span>
                        ↑ {node.maxSendKbps ? `${node.maxSendKbps} KiB/s` : 'unlimited'} / ↓{' '}
                        {node.maxRecvKbps ? `${node.maxRecvKbps} KiB/s` : 'unlimited'}
                      </span>
                      <button
                        disabled={busy || !valid}
                        onClick={() =>
                          run(
                            `Set ${deviceById.get(node.nodeId)?.name ?? node.nodeId}'s global limits to ↑${send} / ↓${recv} KiB/s (0 = unlimited)?`,
                            () => mutations.setBandwidthLimits(node.nodeId, limits()).then(load),
                          )
                        }
                      >
                        Apply here
                      </button>
                    </div>
                  )}
                </div>
              ))}
              <div className="cluster-actions__row">
                <span className="cluster-actions__label">Set (KiB/s)</span>
                <div className="detail-panel__action-row">
                  <label>
                    ↑
                    <input type="number" min={0} value={send} disabled={busy} onChange={(e) => setSend(e.target.value)} />
                  </label>
                  <label>
                    ↓
                    <input type="number" min={0} value={recv} disabled={busy} onChange={(e) => setRecv(e.target.value)} />
                  </label>
                  <button
                    className="detail-panel__button--warning"
                    disabled={busy || !valid}
                    onClick={() =>
                      run(
                        `Set EVERY registered node's global limits to ↑${send} / ↓${recv} KiB/s (0 = unlimited)?`,
                        () => mutations.setBandwidthLimits(undefined, limits()).then(load),
                      )
                    }
                  >
                    Apply to all nodes
                  </button>
                  <button className="detail-panel__link-button" disabled={loading} onClick={load}>
                    {loading ? 'Reloading…' : 'Reload'}
                  </button>
                </div>
              </div>
            </>
          )}
        </div>
        {loadError && <div className="detail-panel__error cluster-actions__error">{loadError}</div>}
        {error && <div className="detail-panel__error cluster-actions__error">{error}</div>}
    </article>
  )
}

/**
 * Tiny single-series completion line for a folder-card row. Fixed 0–100
 * y-domain (see sparkline.ts), accent-colored — text next to it stays in
 * text tokens, the line alone carries no information color couldn't lose.
 */
function Sparkline({ points }: { points: CompletionPoint[] }) {
  const geometry = sparklineGeometry(points, 60, 18)
  if (!geometry) return null
  return (
    <svg
      className="sparkline"
      viewBox="0 0 60 18"
      width={60}
      height={18}
      role="img"
      aria-label={geometry.label}
    >
      <title>{geometry.label}</title>
      <path d={geometry.d} />
    </svg>
  )
}

/**
 * One drift finding: the deep-linking row, plus — when the finding carries a
 * machine-applicable fix and the source is live — an Apply-fix button that
 * runs the corresponding existing mutation(s), confirmation-gated like every
 * other mutation. Own busy/error state per row.
 */
function DriftRow({
  cluster,
  finding,
  isLive,
  nameFor,
  onOpenShare,
}: {
  cluster: ClusterModel
  finding: DriftFinding
  isLive?: boolean
  /** Passed from the parent, which already has the deviceById map — no per-row rebuild. */
  nameFor: (id: string) => string
  onOpenShare?: (share: Share) => void
}) {
  const { busy, error, run } = useAsyncAction()
  const folderLabel = cluster.folders.find((f) => f.id === finding.folderId)?.label ?? finding.folderId
  const target = cluster.shares.find(
    (s) => s.folderId === finding.folderId && finding.deviceIds.includes(s.deviceId),
  )

  const applyFix = (fix: DriftFix) => {
    if (fix.kind === 'set-label') {
      run(
        `Rename the folder to “${fix.label}” on ${fix.deviceIds.map(nameFor).join(', ')}?`,
        async () => {
          // Sequential on purpose: the proxy serializes folder edits anyway,
          // and a failure should stop before touching the remaining nodes.
          for (const deviceId of fix.deviceIds) {
            await mutations.setFolderLabel(deviceId, finding.folderId, fix.label)
          }
        },
      )
    } else {
      run(
        `Add ${nameFor(fix.addDevice)} to "${folderLabel}"'s share list on ${nameFor(fix.onDevice)}?`,
        () => mutations.addShare(fix.onDevice, finding.folderId, fix.addDevice),
      )
    }
  }

  return (
    <li className="drift-row">
      <button className="attention-list__row" onClick={() => target && onOpenShare?.(target)}>
        <span
          className={`drift-badge drift-badge--${finding.severity}`}
          title={finding.severity === 'warning' ? 'Probably broken' : 'Legal, but worth knowing'}
        >
          {finding.severity === 'warning' ? '⚠' : 'ℹ'}
        </span>
        <strong>{folderLabel}</strong>
        <span className="attention-list__device">{finding.message}</span>
        <span className="attention-list__message">Fix: {finding.suggestion}</span>
      </button>
      {isLive && finding.fix && (
        <div className="detail-panel__action-row drift-row__fix">
          <button
            className="detail-panel__button--primary"
            disabled={busy}
            onClick={() => applyFix(finding.fix!)}
          >
            Apply fix
          </button>
        </div>
      )}
      {error && <div className="detail-panel__error">{error}</div>}
    </li>
  )
}

const UPGRADE_STATUS_LABELS: Record<UpgradeNodeStatus, string> = {
  pending: 'queued',
  checking: 'checking…',
  'up-to-date': 'up to date',
  upgrading: 'upgrading…',
  done: 'upgraded',
  failed: 'FAILED',
  skipped: 'skipped',
}

/**
 * Cluster upgrade orchestration: every node, strictly one at a time, each
 * health-checked back before the next starts (a failure aborts the sweep).
 * The run lives on the proxy; this card starts it and polls while it runs.
 */
function UpgradeSection({ cluster }: { cluster: ClusterModel }) {
  const { busy, error, run: confirmRun } = useAsyncAction()
  const [run, setRun] = useState<UpgradeRun | null>(null)
  const [loaded, setLoaded] = useState(false)
  const [loadError, setLoadError] = useState<string>()

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))

  const load = () => {
    mutations
      .getUpgradeRun()
      .then((res) => {
        setRun(res.run)
        setLoaded(true)
        setLoadError(undefined)
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
  }

  // While a sweep is running, keep the per-node statuses fresh.
  useEffect(() => {
    if (!run?.running) return
    const timer = setInterval(load, 3000)
    return () => clearInterval(timer)
  }, [run?.running])

  return (
    <article className="folder-card">
        <div className="cluster-actions__body">
          <div className="detail-panel__action-row">
            <button
              className="detail-panel__button--warning"
              disabled={busy || run?.running === true}
              onClick={() =>
                confirmRun(
                  'Upgrade Syncthing on every registered node, one node at a time? Each node restarts during its upgrade; a node that fails to come back aborts the rest.',
                  () => mutations.startUpgradeAll().then(load),
                )
              }
            >
              {run?.running ? 'Upgrade in progress…' : 'Upgrade all nodes'}
            </button>
            <button className="detail-panel__link-button" onClick={load}>
              {loaded ? 'Reload' : 'Load status'}
            </button>
          </div>
          {run && (
            <ul className="upgrade-run">
              {run.nodes.map((node) => (
                <li key={node.nodeId} className={node.status === 'failed' ? 'detail-panel__error' : undefined}>
                  <strong>{deviceById.get(node.nodeId)?.name ?? node.nodeId}</strong>{' '}
                  {UPGRADE_STATUS_LABELS[node.status]}
                  {node.fromVersion &&
                    node.toVersion &&
                    node.fromVersion !== node.toVersion &&
                    ` (${node.fromVersion} → ${node.toVersion})`}
                  {node.detail && <span className="recent-changes__detail"> — {node.detail}</span>}
                </li>
              ))}
            </ul>
          )}
          {run && !run.running && (
            <p className="recent-changes__empty">
              {run.aborted
                ? 'Run aborted — fix the failed node before retrying.'
                : `Finished ${run.finishedAt ? new Date(run.finishedAt).toLocaleTimeString() : ''}`}
            </p>
          )}
        </div>
        {loadError && <div className="detail-panel__error cluster-actions__error">{loadError}</div>}
        {error && <div className="detail-panel__error cluster-actions__error">{error}</div>}
    </article>
  )
}

/**
 * The raw event log — every Syncthing event both proxy event loops receive,
 * merged newest-first. The diagnostic view behind the friendlier
 * recent-changes feed; filtering is client-side over the (bounded) buffer.
 */
function EventLogSection({ cluster }: { cluster: ClusterModel }) {
  const [view, setView] = useState<EventLogView>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [typeFilter, setTypeFilter] = useState('')
  const [nodeFilter, setNodeFilter] = useState('')

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const managed = cluster.devices.filter((d) => d.managed)

  const load = () => {
    setLoading(true)
    setLoadError(undefined)
    mutations
      .getEventLog()
      .then(setView)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  const filtered = (view?.events ?? []).filter(
    (e) =>
      (typeFilter === '' || e.type.toLowerCase().includes(typeFilter.toLowerCase())) &&
      (nodeFilter === '' || e.nodeId === nodeFilter),
  )

  return (
    <article className="folder-card">
        <div className="detail-panel__action-row event-log__filters">
          <button className="detail-panel__link-button" disabled={loading} onClick={load}>
            {loading ? 'Loading…' : view ? 'Reload' : 'Load'}
          </button>
        </div>
        {view && (
          <>
            <div className="detail-panel__action-row event-log__filters">
              <input
                type="text"
                placeholder="Filter by event type…"
                value={typeFilter}
                onChange={(e) => setTypeFilter(e.target.value)}
              />
              <select value={nodeFilter} onChange={(e) => setNodeFilter(e.target.value)}>
                <option value="">All nodes</option>
                {managed.map((d) => (
                  <option key={d.id} value={d.id}>
                    {d.name}
                  </option>
                ))}
              </select>
            </div>
            {filtered.length === 0 ? (
              <p className="recent-changes__empty">
                {view.events.length === 0
                  ? 'No events buffered yet (the log starts empty on a proxy restart).'
                  : 'No events match the filter.'}
              </p>
            ) : (
              <ul className="recent-changes event-log">
                {filtered.map((event, i) => (
                  <li key={`${event.nodeId}:${event.id}:${i}`}>
                    <span className="recent-changes__time">
                      {new Date(event.time).toLocaleTimeString()}
                    </span>{' '}
                    <strong>{event.type}</strong>
                    <span className="recent-changes__detail">
                      {' '}
                      on {deviceById.get(event.nodeId)?.name ?? event.nodeId}
                    </span>
                    <span className="event-log__data">{JSON.stringify(event.data)}</span>
                  </li>
                ))}
              </ul>
            )}
          </>
        )}
        {loadError && <div className="detail-panel__error cluster-actions__error">{loadError}</div>}
    </article>
  )
}

/**
 * The cluster-wide recent-changes feed — every node's disk-change events,
 * merged newest-first by the proxy (bounded, in-memory). Loaded on demand:
 * it's a glance backwards, not live state, so it doesn't ride the SSE model.
 */
function RecentChangesSection({ cluster }: { cluster: ClusterModel }) {
  const [view, setView] = useState<RecentChangesView>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const nameFor = (id: string) => deviceById.get(id)?.name ?? id
  const folderLabel = (id: string) => cluster.folders.find((f) => f.id === id)?.label ?? id

  const load = () => {
    setLoading(true)
    setLoadError(undefined)
    mutations
      .getRecentChanges()
      .then(setView)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  return (
    <article className="folder-card">
        <div className="detail-panel__action-row event-log__filters">
          <button className="detail-panel__link-button" disabled={loading} onClick={load}>
            {loading ? 'Loading…' : view ? 'Reload' : 'Load'}
          </button>
        </div>
        {view &&
          (view.changes.length === 0 ? (
            <p className="recent-changes__empty">
              Nothing yet — the feed fills as changes are detected (it starts empty on a proxy
              restart).
            </p>
          ) : (
            <ul className="recent-changes">
              {view.changes.map((change, i) => (
                <li key={`${change.time}:${change.nodeId}:${change.path}:${i}`}>
                  <span className="recent-changes__time">
                    {new Date(change.time).toLocaleTimeString()}
                  </span>{' '}
                  <strong>{change.action}</strong> <code>{change.path}</code>
                  <span className="recent-changes__detail">
                    {' '}
                    in {folderLabel(change.folderId)} on {nameFor(change.nodeId)}
                    {change.origin === 'remote' &&
                      ` (from ${change.modifiedBy ? nameFor(change.modifiedBy) : 'a peer'})`}
                  </span>
                </li>
              ))}
            </ul>
          ))}
        {loadError && <div className="detail-panel__error cluster-actions__error">{loadError}</div>}
    </article>
  )
}

/** Own busy/error instance per row — sharing one across N+M rows would let one in-flight dismiss disable every other row's buttons. */
function PendingDeviceRow({
  pd,
  nameFor,
  isLive,
  onAccept,
}: {
  pd: PendingDevice
  nameFor: (id: string) => string
  isLive?: boolean
  onAccept: () => void
}) {
  const { busy, error, run } = useAsyncAction()
  return (
    <li className="pending-row">
      <div className="pending-row__info">
        <strong>{pd.name ?? pd.deviceId}</strong>
        <span className="pending-row__detail">
          tried to connect on {pd.seenOn.map((s) => nameFor(s.nodeId)).join(', ')}
        </span>
      </div>
      {isLive && (
        <div className="detail-panel__action-row">
          <button className="detail-panel__button--primary" onClick={onAccept}>
            Accept
          </button>
          <button
            className="detail-panel__button--danger"
            disabled={busy}
            onClick={() =>
              run(`Dismiss ${pd.name ?? pd.deviceId}? It'll resurface if it tries to connect again.`, () =>
                mutations.dismissPendingDevice(pd.deviceId),
              )
            }
          >
            Dismiss
          </button>
        </div>
      )}
      {error && <div className="detail-panel__error">{error}</div>}
    </li>
  )
}

function PendingFolderOfferRow({
  pf,
  offer,
  nameFor,
  isLive,
  onAccept,
}: {
  pf: ClusterModel['pendingFolders'][number]
  offer: ClusterModel['pendingFolders'][number]['offers'][number]
  nameFor: (id: string) => string
  isLive?: boolean
  onAccept: () => void
}) {
  const { busy, error, run } = useAsyncAction()
  return (
    <li className="pending-row">
      <div className="pending-row__info">
        <strong>{pf.label}</strong>
        <span className="pending-row__detail">
          offered by {nameFor(offer.offeredBy)} on {nameFor(offer.nodeId)}
          {offer.receiveEncrypted && ' (encrypted)'}
        </span>
      </div>
      {isLive && (
        <div className="detail-panel__action-row">
          <button className="detail-panel__button--primary" onClick={onAccept}>
            Accept
          </button>
          <button
            className="detail-panel__button--danger"
            disabled={busy}
            onClick={() =>
              run(
                `Dismiss "${pf.label}" offered by ${nameFor(offer.offeredBy)} on ${nameFor(offer.nodeId)}?`,
                () => mutations.dismissPendingFolder(offer.nodeId, pf.folderId, offer.offeredBy),
              )
            }
          >
            Dismiss
          </button>
        </div>
      )}
      {error && <div className="detail-panel__error">{error}</div>}
    </li>
  )
}

/**
 * The cluster-wide "inbox": devices that have tried to connect and folders
 * peers have offered, merged across every registered node that's seen them.
 * See ROADMAP.md Phase 5. Content shows on fixtures too (so it's part of the
 * visual language); only the actions are gated to the live source.
 */
function PendingSection({ cluster, isLive }: { cluster: ClusterModel; isLive?: boolean }) {
  const [deviceDialog, setDeviceDialog] = useState<PendingDevice | null>(null)
  const [folderDialog, setFolderDialog] = useState<{ folderId: string; offer: PendingFolderOffer } | null>(
    null,
  )

  if (cluster.pendingDevices.length === 0 && cluster.pendingFolders.length === 0) return null

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const nameFor = (id: string) => deviceById.get(id)?.name ?? id

  return (
    <>
      <article className="folder-card">
        <ul className="pending-list">
          {cluster.pendingDevices.map((pd) => (
            <PendingDeviceRow
              key={pd.deviceId}
              pd={pd}
              nameFor={nameFor}
              isLive={isLive}
              onAccept={() => setDeviceDialog(pd)}
            />
          ))}
          {cluster.pendingFolders.flatMap((pf) =>
            pf.offers.map((offer) => (
              <PendingFolderOfferRow
                key={`${pf.folderId}:${offer.nodeId}:${offer.offeredBy}`}
                pf={pf}
                offer={offer}
                nameFor={nameFor}
                isLive={isLive}
                onAccept={() =>
                  setFolderDialog({
                    folderId: pf.folderId,
                    offer: {
                      nodeId: offer.nodeId,
                      offeredBy: offer.offeredBy,
                      label: offer.label,
                      receiveEncrypted: offer.receiveEncrypted,
                    },
                  })
                }
              />
            )),
          )}
        </ul>
      </article>

      {deviceDialog && (
        <AcceptPendingDeviceDialog
          cluster={cluster}
          pending={deviceDialog}
          onClose={() => setDeviceDialog(null)}
        />
      )}
      {folderDialog && (
        <AcceptPendingFolderDialog
          folderId={folderDialog.folderId}
          offer={folderDialog.offer}
          onClose={() => setFolderDialog(null)}
        />
      )}
    </>
  )
}

function StatTile({
  label,
  value,
  detail,
  title,
}: {
  label: string
  value: string
  detail?: string
  title?: string
}) {
  return (
    <div className="stat-tile" title={title}>
      <div className="stat-tile__label">{label}</div>
      <div className="stat-tile__value">{value}</div>
      {detail && <div className="stat-tile__detail">{detail}</div>}
    </div>
  )
}

function CompletionMeter({ pct }: { pct: number }) {
  return (
    <span className="meter" role="meter" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100}>
      <span className="meter__fill" style={{ width: `${pct}%`, backgroundColor: cssColor(STATUS.activity) }} />
    </span>
  )
}

/** DEVICE_STATE_STYLE uses its own `accent` token, not the folder-state palette StatusBadge expects. */
function DeviceStatusBadge({ state }: { state: ClusterModel['devices'][number]['state'] }) {
  const style = DEVICE_STATE_STYLE[state]
  return (
    <span className="status-badge">
      <span className="status-badge__dot" style={{ backgroundColor: cssColor(style.accent) }} />
      {style.label}
    </span>
  )
}

/** Own useAsyncAction instance per card — a shared one would show one row's busy/error state on every other row's button too. */
function NodeCard({
  cluster,
  device,
  onOpenShare,
  isLive,
}: {
  cluster: ClusterModel
  device: Device
  onOpenShare?: (share: Share) => void
  isLive?: boolean
}) {
  const shares = sharesByDevice(cluster, device.id)
  const worst = folderHealthForDevice(cluster, device.id)
  const { busy, error, run } = useAsyncAction()

  return (
    <article className="folder-card">
      <header className="folder-card__header">
        <h4>{device.name}</h4>
        {worst ? <StatusBadge state={worst} /> : <DeviceStatusBadge state={device.state} />}
      </header>
      {shares.length > 0 ? (
        <ul className="folder-card__shares">
          {shares.map((share) => (
            <li key={share.folderId}>
              <button className="folder-card__share-row" onClick={() => onOpenShare?.(share)}>
                <span className="folder-card__device">
                  {cluster.folders.find((f) => f.id === share.folderId)?.label ?? share.folderId}
                </span>
                <span className="folder-card__type">{FOLDER_TYPE_STYLE[share.type].label}</span>
                {share.completionPct !== undefined && share.completionPct < 100 ? (
                  <span className="folder-card__completion">
                    <CompletionMeter pct={share.completionPct} />
                    <span className="folder-card__pct">{share.completionPct}%</span>
                  </span>
                ) : (
                  <StatusBadge state={share.state} />
                )}
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="folder-card__empty">
          {device.managed ? 'No folders shared here.' : 'Known only from another node’s config.'}
        </div>
      )}
      {isLive && device.managed && (
        <div className="folder-card__footer">
          <button
            className="detail-panel__button--danger"
            disabled={busy}
            onClick={() =>
              run(
                `Remove ${device.name} as a registered node? This proxy will stop managing and polling it — ` +
                  `it stays configured as a peer on any other node that already has it, and its own Syncthing ` +
                  `config is untouched.`,
                () => mutations.removeNode(device.id),
              )
            }
          >
            Remove node
          </button>
          {error && <p className="dialog__error">{error}</p>}
        </div>
      )}
    </article>
  )
}

export function OverviewView({ cluster, onOpenShare, isLive }: OverviewViewProps) {
  // Sparkline data: fetched (and refreshed) quietly — history is
  // supplementary; a fetch failure just means cards render without lines.
  const [history, setHistory] = useState<CompletionHistoryView>()
  useEffect(() => {
    if (!isLive) {
      setHistory(undefined)
      return
    }
    let cancelled = false
    const load = () =>
      mutations
        .getCompletionHistory()
        .then((h) => {
          if (!cancelled) setHistory(h)
        })
        .catch(() => undefined)
    void load()
    const timer = setInterval(load, 30_000)
    return () => {
      cancelled = true
      clearInterval(timer)
    }
  }, [isLive])
  const seriesFor = (folderId: string, deviceId: string) =>
    history?.series.find((s) => s.folderId === folderId && s.deviceId === deviceId)?.points

  const health = clusterHealth(cluster)
  const transfer = clusterTransferTotals(cluster)
  const outBps = cluster.connections.reduce((sum, c) => sum + (c.outBps ?? 0), 0)
  const inBps = cluster.connections.reduce((sum, c) => sum + (c.inBps ?? 0), 0)
  const drift = detectDrift(cluster)
  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const nameFor = (id: string) => deviceById.get(id)?.name ?? id

  const online = health.deviceCounts.connected + health.deviceCounts['this-device']
  const foldersIdle = health.folderCounts.idle
  const deviceDetail = [
    health.deviceCounts.paused > 0 ? `${health.deviceCounts.paused} paused` : undefined,
    health.deviceCounts.disconnected > 0
      ? `${health.deviceCounts.disconnected} disconnected`
      : undefined,
  ]
    .filter(Boolean)
    .join(', ')

  // Section layout (ROADMAP "UI design refinement"): every section below the
  // KPI row is collapsible and re-arrangeable, persisted per browser. A
  // section with null content (fixture source, nothing pending, no drift)
  // keeps its slot in the order but renders nothing.
  const [layout, setLayout] = useState<SectionLayout>(() => loadPref('overviewLayout', EMPTY_LAYOUT))
  const updateLayout = (next: SectionLayout) => {
    setLayout(next)
    savePref('overviewLayout', next)
  }

  const sections: { id: string; title: string; content: ReactNode | null }[] = [
    { id: 'actions', title: 'Cluster actions', content: isLive ? <ClusterActions /> : null },
    { id: 'bandwidth', title: 'Bandwidth limits', content: isLive ? <BandwidthSection cluster={cluster} /> : null },
    { id: 'upgrades', title: 'Upgrades', content: isLive ? <UpgradeSection cluster={cluster} /> : null },
    { id: 'changes', title: 'Recent changes', content: isLive ? <RecentChangesSection cluster={cluster} /> : null },
    { id: 'eventlog', title: 'Event log', content: isLive ? <EventLogSection cluster={cluster} /> : null },
    {
      id: 'attention',
      title: 'Needs attention',
      content:
        health.attention.length > 0 ? (
          <ul className="attention-list">
            {health.attention.map((share) => (
              <li key={`${share.folderId}:${share.deviceId}`}>
                <button className="attention-list__row" onClick={() => onOpenShare?.(share)}>
                  <StatusBadge state={share.state} />
                  <strong>{cluster.folders.find((f) => f.id === share.folderId)?.label ?? share.folderId}</strong>
                  <span className="attention-list__device">
                    on {deviceById.get(share.deviceId)?.name ?? share.deviceId}
                  </span>
                  {share.errorMessage && (
                    <span className="attention-list__message">{share.errorMessage}</span>
                  )}
                </button>
              </li>
            ))}
          </ul>
        ) : null,
    },
    {
      id: 'drift',
      title: 'Config drift',
      content:
        drift.length > 0 ? (
          <ul className="attention-list">
            {drift.map((finding, i) => (
              <DriftRow
                key={`${finding.kind}:${finding.folderId}:${i}`}
                cluster={cluster}
                finding={finding}
                isLive={isLive}
                nameFor={nameFor}
                onOpenShare={onOpenShare}
              />
            ))}
          </ul>
        ) : null,
    },
    {
      id: 'pending',
      title: 'Pending',
      content:
        cluster.pendingDevices.length > 0 || cluster.pendingFolders.length > 0 ? (
          <PendingSection cluster={cluster} isLive={isLive} />
        ) : null,
    },
    {
      id: 'nodes',
      title: 'Nodes',
      content: (
        <div className="folder-cards">
          {cluster.devices.map((device) => (
            <NodeCard
              key={device.id}
              cluster={cluster}
              device={device}
              onOpenShare={onOpenShare}
              isLive={isLive}
            />
          ))}
        </div>
      ),
    },
    {
      id: 'folders',
      title: 'Folders',
      content: (
        <div className="folder-cards">
          {cluster.folders.map((folder) => {
            const shares = sharesByFolder(cluster, folder.id)
            const worst = folderHealth(cluster, folder.id)
            return (
              <article className="folder-card" key={folder.id}>
                <header className="folder-card__header">
                  <h4>{folder.label}</h4>
                  {worst && <StatusBadge state={worst} />}
                </header>
                <ul className="folder-card__shares">
                  {shares.map((share) => {
                    const points = seriesFor(share.folderId, share.deviceId)
                    return (
                      <li key={share.deviceId}>
                        <span className="folder-card__device">
                          {deviceById.get(share.deviceId)?.name ?? share.deviceId}
                        </span>
                        <span className="folder-card__type">
                          {FOLDER_TYPE_STYLE[share.type].label}
                        </span>
                        {points && <Sparkline points={points} />}
                        {share.completionPct !== undefined && share.completionPct < 100 ? (
                          <span className="folder-card__completion">
                            <CompletionMeter pct={share.completionPct} />
                            <span className="folder-card__pct">{share.completionPct}%</span>
                          </span>
                        ) : (
                          <StatusBadge state={share.state} />
                        )}
                      </li>
                    )
                  })}
                </ul>
              </article>
            )
          })}
        </div>
      ),
    },
  ]
  const sectionById = new Map(sections.map((s) => [s.id, s]))
  const order = normalizeOrder(
    layout.order,
    sections.map((s) => s.id),
  )
  const visibleIds = order.filter((id) => sectionById.get(id)!.content !== null)

  return (
    <div className="overview">
      <div className="kpi-row">
        <StatTile
          label="Devices online"
          value={`${online}/${cluster.devices.length}`}
          detail={deviceDetail || undefined}
        />
        <StatTile
          label="Folders up to date"
          value={`${foldersIdle}/${cluster.folders.length}`}
          detail={
            health.folderCounts.syncing + health.folderCounts.scanning > 0
              ? `${health.folderCounts.syncing + health.folderCounts.scanning} active`
              : undefined
          }
        />
        <StatTile
          label="Out-of-sync items"
          value={String(health.outOfSyncItems)}
          detail={health.failedItems > 0 ? `${health.failedItems} failed` : undefined}
        />
        <StatTile label="Needs attention" value={String(health.attention.length)} />
        <StatTile
          label="Data transferred"
          value={formatBytes(transfer.inBytesTotal + transfer.outBytesTotal)}
          detail={
            `↑${formatBytes(transfer.outBytesTotal)} / ↓${formatBytes(transfer.inBytesTotal)}` +
            (outBps + inBps > 0 ? ` · now ↑${formatRate(outBps)} / ↓${formatRate(inBps)}` : '')
          }
          title="Cumulative for each connection's current session only — resets to 0 on disconnect or a restart, not a durable all-time total. A link between two managed nodes is counted from both ends."
        />
      </div>

      {order.map((id) => {
        const section = sectionById.get(id)!
        if (section.content === null) return null
        return (
          <OverviewSection
            key={id}
            title={section.title}
            collapsed={layout.collapsed.includes(id)}
            canMoveUp={visibleIds.indexOf(id) > 0}
            canMoveDown={visibleIds.indexOf(id) < visibleIds.length - 1}
            onToggle={() =>
              updateLayout({ ...layout, collapsed: toggleCollapsed(layout.collapsed, id) })
            }
            onMove={(direction) =>
              updateLayout({ ...layout, order: moveSection(order, id, direction, visibleIds) })
            }
          >
            {section.content}
          </OverviewSection>
        )
      })}
    </div>
  )
}
