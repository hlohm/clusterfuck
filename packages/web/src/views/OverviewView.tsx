import type { ClusterModel, Share } from '@clusterfuck/shared'
import { clusterHealth, folderHealth, sharesByFolder } from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { STATUS } from '../encoding/colors'
import { cssColor } from '../encoding/colors'
import { StatusBadge } from './StatusBadge'
import { useAsyncAction } from '../data/useAsyncAction'
import * as mutations from '../data/mutations'

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
      <h3>Cluster actions</h3>
      <div className="detail-panel__action-row">
        <button
          className="detail-panel__button--warning"
          disabled={busy}
          onClick={() => run('Pause every device on every registered node?', () => mutations.setAllDevicesPaused(true))}
        >
          Pause all devices
        </button>
        <button
          disabled={busy}
          onClick={() => run('Resume every device on every registered node?', () => mutations.setAllDevicesPaused(false))}
        >
          Resume all devices
        </button>
        <button
          className="detail-panel__button--warning"
          disabled={busy}
          onClick={() => run('Pause every folder on every registered node?', () => mutations.setAllFoldersPaused(true))}
        >
          Pause all folders
        </button>
        <button
          disabled={busy}
          onClick={() => run('Resume every folder on every registered node?', () => mutations.setAllFoldersPaused(false))}
        >
          Resume all folders
        </button>
      </div>
      {error && <div className="detail-panel__error">{error}</div>}
    </section>
  )
}

function StatTile({ label, value, detail }: { label: string; value: string; detail?: string }) {
  return (
    <div className="stat-tile">
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

export function OverviewView({ cluster, onOpenShare, isLive }: OverviewViewProps) {
  const health = clusterHealth(cluster)
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
        <StatTile label="Out-of-sync items" value={String(health.outOfSyncItems)} />
        <StatTile label="Needs attention" value={String(health.attention.length)} />
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
