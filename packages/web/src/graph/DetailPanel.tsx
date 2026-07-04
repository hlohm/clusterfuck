import { useState } from 'react'
import type { ClusterModel, Device, FolderType, Share } from '@clusterfuck/shared'
import type { Selection } from './selection'
import { sharesByDevice, sharesByFolder } from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { FOLDER_STATE_STYLE } from '../encoding/folderStateStyle'
import { DEVICE_STATE_STYLE } from '../encoding/deviceStateStyle'
import { StatusBadge } from '../views/StatusBadge'
import * as mutations from '../data/mutations'

export interface DetailPanelProps {
  cluster: ClusterModel
  selection: Selection
  /** Mutation actions only make sense against the live proxy, never fixtures. */
  isLive: boolean
}

function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  /** CLAUDE.md gates every Phase 3 mutation behind a confirmation. Returns false if declined. */
  const run = (confirmMessage: string | null, fn: () => Promise<void>): boolean => {
    if (confirmMessage !== null && !window.confirm(confirmMessage)) return false
    setBusy(true)
    setError(undefined)
    fn()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Action failed')
      })
      .finally(() => setBusy(false))
    return true
  }

  return { busy, error, run }
}

function DeviceActions({ device }: { device: Device }) {
  const { busy, error, run } = useAsyncAction()

  if (device.state === 'this-device') return null

  const pausing = device.state !== 'paused'
  return (
    <div className="detail-panel__actions">
      <div className="detail-panel__action-row">
        <button
          disabled={busy}
          onClick={() =>
            run(
              `${pausing ? 'Pause' : 'Resume'} ${device.name} on every registered node?`,
              () => mutations.setDevicePaused(device.id, pausing),
            )
          }
        >
          {pausing ? 'Pause device' : 'Resume device'}
        </button>
      </div>
      {error && <div className="detail-panel__error">{error}</div>}
    </div>
  )
}

const FOLDER_TYPE_OPTIONS = (Object.keys(FOLDER_TYPE_STYLE) as FolderType[]).map((value) => ({
  value,
  label: FOLDER_TYPE_STYLE[value].label,
}))

function ShareActions({ cluster, share }: { cluster: ClusterModel; share: Share }) {
  const { busy, error, run } = useAsyncAction()
  const [addTarget, setAddTarget] = useState('')

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const nodeName = deviceById.get(share.deviceId)?.name ?? share.deviceId
  const folderLabel = cluster.folders.find((f) => f.id === share.folderId)?.label ?? share.folderId
  const addCandidates = cluster.devices.filter((d) => !share.sharedWith.includes(d.id))

  // Converting a live folder to/from receiveencrypted needs an encryption
  // password Syncthing derives per share — a plain type flip would break the
  // folder, so mirror Syncthing's own GUI and don't offer it.
  const isEncrypted = share.type === 'receiveencrypted'
  const typeOptions = FOLDER_TYPE_OPTIONS.filter(
    (opt) => opt.value !== 'receiveencrypted' || isEncrypted,
  )

  const pausing = share.state !== 'paused'
  return (
    <div className="detail-panel__actions">
      <div className="detail-panel__group">
        <div className="detail-panel__group-label">Actions</div>
        <div className="detail-panel__action-row">
          <button
            disabled={busy}
            onClick={() =>
              run(`${pausing ? 'Pause' : 'Resume'} folder "${folderLabel}" on ${nodeName}?`, () =>
                mutations.setFolderPaused(share.deviceId, share.folderId, pausing),
              )
            }
          >
            {pausing ? 'Pause folder' : 'Resume folder'}
          </button>
          <button
            disabled={busy}
            onClick={() => run(null, () => mutations.rescanFolder(share.deviceId, share.folderId))}
          >
            Rescan
          </button>
        </div>
        <label className="detail-panel__action-row">
          Type:
          <select
            value={share.type}
            disabled={busy || isEncrypted}
            title={isEncrypted ? 'Encrypted folders cannot be converted in place' : undefined}
            onChange={(event) => {
              const type = event.target.value as FolderType
              run(
                `Change folder "${folderLabel}" to ${FOLDER_TYPE_STYLE[type].label} on ${nodeName}?`,
                () => mutations.setFolderType(share.deviceId, share.folderId, type),
              )
            }}
          >
            {typeOptions.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </label>
      </div>

      <div className="detail-panel__group detail-panel__shared-with">
        <div className="detail-panel__group-label">Shared with (via this node)</div>
        <ul>
          {share.sharedWith.map((id) => {
            const name = deviceById.get(id)?.name ?? id
            return (
              <li key={id}>
                <span>{name}</span>
                {id !== share.deviceId && (
                  <button
                    disabled={busy}
                    onClick={() =>
                      run(`Remove ${name} from "${folderLabel}" on ${nodeName}?`, () =>
                        mutations.removeShare(share.deviceId, share.folderId, id),
                      )
                    }
                  >
                    Remove
                  </button>
                )}
              </li>
            )
          })}
        </ul>
        {addCandidates.length > 0 && (
          <div className="detail-panel__action-row">
            <select value={addTarget} disabled={busy} onChange={(event) => setAddTarget(event.target.value)}>
              <option value="">Add device…</option>
              {addCandidates.map((d) => (
                <option key={d.id} value={d.id}>
                  {d.name}
                </option>
              ))}
            </select>
            <button
              disabled={busy || !addTarget}
              onClick={() => {
                const target = addTarget
                const name = deviceById.get(target)?.name ?? target
                const started = run(`Share "${folderLabel}" with ${name} via ${nodeName}?`, () =>
                  mutations.addShare(share.deviceId, share.folderId, target),
                )
                if (started) setAddTarget('')
              }}
            >
              Add
            </button>
          </div>
        )}
      </div>

      {error && <div className="detail-panel__error">{error}</div>}
    </div>
  )
}

export function DetailPanel({ cluster, selection, isLive }: DetailPanelProps) {
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
    const folderById = new Map(cluster.folders.map((f) => [f.id, f]))

    return (
      <aside className="detail-panel">
        <h3>{device.name}</h3>
        <p>
          <strong>State:</strong> {style.label}
        </p>
        <p>
          <strong>Device ID:</strong> <code>{device.id}</code>
        </p>
        {isLive && <DeviceActions device={device} />}
        <h4>Folder shares ({shares.length})</h4>
        <ul>
          {shares.map((share) => {
            const typeStyle = FOLDER_TYPE_STYLE[share.type]
            const stateStyle = FOLDER_STATE_STYLE[share.state]
            const folder = folderById.get(share.folderId)
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
    const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))

    return (
      <aside className="detail-panel">
        <h3>{folder.label}</h3>
        <p>
          <strong>Folder ID:</strong> <code>{folder.id}</code>
        </p>
        <h4>Devices sharing this folder ({shares.length})</h4>
        <div className="detail-panel__nodes">
          {shares.map((share) => {
            const typeStyle = FOLDER_TYPE_STYLE[share.type]
            const device = deviceById.get(share.deviceId)
            return (
              <section className="node-section" key={share.deviceId}>
                <header className="node-section__header">
                  <span className="node-section__name">{device?.name ?? share.deviceId}</span>
                  <StatusBadge state={share.state} />
                </header>
                <div className="node-section__type">{typeStyle.label}</div>
                {isLive && <ShareActions cluster={cluster} share={share} />}
              </section>
            )
          })}
        </div>
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
      {isLive && <ShareActions cluster={cluster} share={share} />}
    </aside>
  )
}
