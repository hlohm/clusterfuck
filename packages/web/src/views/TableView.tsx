import type { ClusterModel, Share } from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { cssColor } from '../encoding/colors'
import { StatusBadge } from './StatusBadge'

export interface TableViewProps {
  cluster: ClusterModel
  onOpenShare?: (share: Share) => void
}

/**
 * Flat table of every share (folder × device). The dependable fallback
 * channel: everything the graph encodes with color/shape is spelled out
 * here as text.
 */
export function TableView({ cluster, onOpenShare }: TableViewProps) {
  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const folderById = new Map(cluster.folders.map((f) => [f.id, f]))

  const rows = [...cluster.shares].sort(
    (a, b) => a.folderId.localeCompare(b.folderId) || a.deviceId.localeCompare(b.deviceId),
  )

  return (
    <div className="table-view">
      <table className="shares-table">
        <thead>
          <tr>
            <th>Folder</th>
            <th>Device</th>
            <th>Type</th>
            <th>State</th>
            <th className="shares-table__num">Completion</th>
            <th className="shares-table__num">Out of sync</th>
            <th>Error</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((share) => {
            const typeStyle = FOLDER_TYPE_STYLE[share.type]
            return (
              <tr
                key={`${share.folderId}:${share.deviceId}`}
                onClick={() => onOpenShare?.(share)}
                className={onOpenShare ? 'shares-table__row--clickable' : undefined}
              >
                <td>
                  <strong>{folderById.get(share.folderId)?.label ?? share.folderId}</strong>
                </td>
                <td>{deviceById.get(share.deviceId)?.name ?? share.deviceId}</td>
                <td>
                  <span className="type-key">
                    <span
                      className="type-key__swatch"
                      style={{
                        backgroundColor: cssColor(typeStyle.color),
                        backgroundImage:
                          typeStyle.dash === 'dashed'
                            ? 'repeating-linear-gradient(90deg, transparent 0 3px, var(--bg) 3px 6px)'
                            : undefined,
                      }}
                    />
                    {typeStyle.label}
                    {typeStyle.icon === 'lock' && <span title="encrypted">🔒</span>}
                  </span>
                </td>
                <td>
                  <StatusBadge state={share.state} />
                </td>
                <td className="shares-table__num">
                  {share.completionPct !== undefined ? `${share.completionPct}%` : '—'}
                </td>
                <td className="shares-table__num">{share.outOfSyncItems ?? '—'}</td>
                <td className="shares-table__error">{share.errorMessage ?? ''}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
