import type { ClusterModel } from '../model/types'
import type { Selection } from './selection'
import { sharesByDevice, sharesByFolder } from '../model/derive'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { FOLDER_STATE_STYLE } from '../encoding/folderStateStyle'
import { DEVICE_STATE_STYLE } from '../encoding/deviceStateStyle'

export interface DetailPanelProps {
  cluster: ClusterModel
  selection: Selection
}

export function DetailPanel({ cluster, selection }: DetailPanelProps) {
  if (!selection) {
    return (
      <aside className="detail-panel detail-panel--empty">
        Select a device, folder, or link to see details.
      </aside>
    )
  }

  if (selection.kind === 'device') {
    const device = cluster.devices.find((d) => d.id === selection.deviceId)
    if (!device) return null
    const style = DEVICE_STATE_STYLE[device.state]
    const shares = sharesByDevice(cluster, device.id)

    return (
      <aside className="detail-panel">
        <h3>{device.name}</h3>
        <p>
          <strong>State:</strong> {style.label}
        </p>
        <p>
          <strong>Device ID:</strong> <code>{device.id}</code>
        </p>
        <h4>Folder shares ({shares.length})</h4>
        <ul>
          {shares.map((share) => {
            const typeStyle = FOLDER_TYPE_STYLE[share.type]
            const stateStyle = FOLDER_STATE_STYLE[share.state]
            const folder = cluster.folders.find((f) => f.id === share.folderId)
            return (
              <li key={share.folderId}>
                <strong>{folder?.label ?? share.folderId}</strong> — {typeStyle.label},{' '}
                {stateStyle.label}
                {share.errorMessage && <div className="detail-panel__error">{share.errorMessage}</div>}
              </li>
            )
          })}
        </ul>
      </aside>
    )
  }

  if (selection.kind === 'folder') {
    const folder = cluster.folders.find((f) => f.id === selection.folderId)
    if (!folder) return null
    const shares = sharesByFolder(cluster, folder.id)

    return (
      <aside className="detail-panel">
        <h3>{folder.label}</h3>
        <p>
          <strong>Folder ID:</strong> <code>{folder.id}</code>
        </p>
        <h4>Devices sharing this folder ({shares.length})</h4>
        <ul>
          {shares.map((share) => {
            const typeStyle = FOLDER_TYPE_STYLE[share.type]
            const stateStyle = FOLDER_STATE_STYLE[share.state]
            const device = cluster.devices.find((d) => d.id === share.deviceId)
            return (
              <li key={share.deviceId}>
                <strong>{device?.name ?? share.deviceId}</strong> — {typeStyle.label},{' '}
                {stateStyle.label}
              </li>
            )
          })}
        </ul>
      </aside>
    )
  }

  // selection.kind === 'share'
  const share = cluster.shares.find(
    (s) => s.folderId === selection.folderId && s.deviceId === selection.deviceId,
  )
  const device = cluster.devices.find((d) => d.id === selection.deviceId)
  const folder = cluster.folders.find((f) => f.id === selection.folderId)
  if (!share || !device || !folder) return null

  const typeStyle = FOLDER_TYPE_STYLE[share.type]
  const stateStyle = FOLDER_STATE_STYLE[share.state]

  return (
    <aside className="detail-panel">
      <h3>
        {device.name} ↔ {folder.label}
      </h3>
      <p>
        <strong>Type:</strong> {typeStyle.label}
      </p>
      <p>
        <strong>State:</strong> {stateStyle.label}
      </p>
      {share.completionPct !== undefined && (
        <p>
          <strong>Completion:</strong> {share.completionPct}%
        </p>
      )}
      {share.outOfSyncItems !== undefined && (
        <p>
          <strong>Out-of-sync items:</strong> {share.outOfSyncItems}
        </p>
      )}
      {share.errorMessage && (
        <p className="detail-panel__error">
          <strong>Error:</strong> {share.errorMessage}
        </p>
      )}
    </aside>
  )
}
