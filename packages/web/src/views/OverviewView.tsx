import { useState } from 'react'
import type { ClusterModel, Device, PendingDevice, Share } from '@clusterfuck/shared'
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
import { formatBytes } from '../format'

export interface OverviewViewProps {
  cluster: ClusterModel
  onOpenShare?: (share: Share) => void
  /** Cluster-wide actions only make sense against the live proxy, never fixtures. */
  isLive?: boolean
}

/** The first cluster-wide (as opposed to per-device/per-folder) mutations — see ROADMAP.md Phase 5. */
function ClusterActions() {
  const { busy, error, run } = useAsyncAction()

  return (
    <section className="overview__section">
      <article className="folder-card">
        <header className="folder-card__header">
          <h4>Cluster actions</h4>
        </header>
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
        </div>
        {error && <div className="detail-panel__error cluster-actions__error">{error}</div>}
      </article>
    </section>
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
    <section className="overview__section">
      <article className="folder-card">
        <header className="folder-card__header">
          <h4>Pending</h4>
        </header>
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
    </section>
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
  const health = clusterHealth(cluster)
  const transfer = clusterTransferTotals(cluster)
  const drift = detectDrift(cluster)
  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))

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
          detail={`↑${formatBytes(transfer.outBytesTotal)} / ↓${formatBytes(transfer.inBytesTotal)}`}
          title="Cumulative for each connection's current session only — resets to 0 on disconnect or a restart, not a durable all-time total. A link between two managed nodes is counted from both ends."
        />
      </div>

      {isLive && <ClusterActions />}

      {health.attention.length > 0 && (
        <section className="overview__section">
          <h3>Needs attention</h3>
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
        </section>
      )}

      {drift.length > 0 && (
        <section className="overview__section">
          <h3>Config drift</h3>
          <ul className="attention-list">
            {drift.map((finding, i) => {
              const folderLabel =
                cluster.folders.find((f) => f.id === finding.folderId)?.label ?? finding.folderId
              const target = cluster.shares.find(
                (s) => s.folderId === finding.folderId && finding.deviceIds.includes(s.deviceId),
              )
              return (
                <li key={`${finding.kind}:${finding.folderId}:${i}`}>
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
                </li>
              )
            })}
          </ul>
        </section>
      )}

      <PendingSection cluster={cluster} isLive={isLive} />

      <section className="overview__section">
        <h3>Nodes</h3>
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
      </section>

      <section className="overview__section">
        <h3>Folders</h3>
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
                  {shares.map((share) => (
                    <li key={share.deviceId}>
                      <span className="folder-card__device">
                        {deviceById.get(share.deviceId)?.name ?? share.deviceId}
                      </span>
                      <span className="folder-card__type">
                        {FOLDER_TYPE_STYLE[share.type].label}
                      </span>
                      {share.completionPct !== undefined && share.completionPct < 100 ? (
                        <span className="folder-card__completion">
                          <CompletionMeter pct={share.completionPct} />
                          <span className="folder-card__pct">{share.completionPct}%</span>
                        </span>
                      ) : (
                        <StatusBadge state={share.state} />
                      )}
                    </li>
                  ))}
                </ul>
              </article>
            )
          })}
        </div>
      </section>
    </div>
  )
}
