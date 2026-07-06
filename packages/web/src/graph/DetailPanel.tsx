import { useState } from 'react'
import type {
  ClusterModel,
  Connection,
  Device,
  DeviceOptionsView,
  DeviceSystemStatus,
  FolderConflicts,
  FolderFailedItems,
  FolderIgnores,
  FolderType,
  ServiceHealth,
  Share,
  TransferTotals,
  VersioningType,
} from '@clusterfuck/shared'
import type { Selection } from './selection'
import {
  COMPRESSION_LEVELS,
  connectionsByDevice,
  MIN_DISK_FREE_UNITS,
  sharesByDevice,
  sharesByFolder,
  sumTransfer,
  VERSIONING_TYPES,
} from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { FOLDER_STATE_STYLE } from '../encoding/folderStateStyle'
import { DEVICE_STATE_STYLE } from '../encoding/deviceStateStyle'
import { StatusBadge } from '../views/StatusBadge'
import { useAsyncAction } from '../data/useAsyncAction'
import * as mutations from '../data/mutations'
import { formatBytes, formatDuration } from '../format'
import {
  describeVersioning,
  formFieldsFor,
  paramsFromFormFields,
  versioningFieldsValid,
  VERSIONING_FIELDS,
  VERSIONING_TYPE_LABELS,
} from '../views/versioning'
import { ignoresDiffer, patternsToText, textToPatterns } from '../views/ignores'
import {
  advancedFieldsValid,
  advancedFormFields,
  advancedFromFormFields,
  describeAdvanced,
} from '../views/advancedOptions'
import {
  deviceOptionsDiffer,
  deviceOptionsFieldsValid,
  deviceOptionsFormFields,
  deviceOptionsFromFormFields,
  type DeviceOptionsFormFields,
} from '../views/deviceOptions'

export interface DetailPanelProps {
  cluster: ClusterModel
  selection: Selection
  onSelect: (selection: Selection) => void
  /** Mutation actions only make sense against the live proxy, never fixtures. */
  isLive: boolean
}

function ServiceHealthLine({ label, health }: { label: string; health: ServiceHealth }) {
  return (
    <p>
      <strong>{label}:</strong> {health.ok}/{health.total} OK
      {health.errors.length > 0 && (
        <span className="detail-panel__status-errors"> — {health.errors.join('; ')}</span>
      )}
    </p>
  )
}

/** Only ever present on a managed device — its own version/uptime/RAM/listener/discovery status, first-hand. */
function SystemStatusSection({ status }: { status: DeviceSystemStatus }) {
  return (
    <div className="detail-panel__system-status">
      <h4>System status</h4>
      <p>
        <strong>Version:</strong> {status.version || 'unknown'}
      </p>
      <p>
        <strong>Uptime:</strong> {formatDuration(status.uptimeSeconds)}
      </p>
      <p>
        <strong>Memory:</strong> {formatBytes(status.ramBytes)}
      </p>
      <ServiceHealthLine label="Listeners" health={status.listeners} />
      <ServiceHealthLine label="Discovery" health={status.discovery} />
    </div>
  )
}

/**
 * A device's own reported connections — like Folder shares, only ever
 * present for a managed device (connectionsByDevice is naturally empty for
 * a peer known only via another node's config, same as sharesByDevice).
 * Sums `connections` directly (the caller already filtered it) rather than
 * taking a separately-computed totals prop, so there's only one filter of
 * cluster.connections per render, not two.
 */
function ConnectionsSection({
  connections,
  deviceById,
}: {
  connections: Connection[]
  deviceById: Map<string, Device>
}) {
  const totals: TransferTotals = sumTransfer(connections)
  return (
    <>
      <h4>Connections ({connections.length})</h4>
      {connections.length > 0 && (
        <p
          title="Cumulative for each connection's current session only — resets to 0 on disconnect or a restart, not a durable all-time total."
        >
          <strong>Total transfer:</strong> ↑{formatBytes(totals.outBytesTotal)} / ↓
          {formatBytes(totals.inBytesTotal)}
        </p>
      )}
      <ul className="connections-list">
        {connections.map((c) => (
          <li key={c.peerId} className="connections-list__row">
            <strong>{deviceById.get(c.peerId)?.name ?? c.peerId}</strong>
            <span className="connections-list__detail">
              {c.connected ? 'Connected' : 'Disconnected'} — ↑{formatBytes(c.outBytesTotal)} / ↓
              {formatBytes(c.inBytesTotal)}
            </span>
          </li>
        ))}
      </ul>
    </>
  )
}

function DeviceActions({ device }: { device: Device }) {
  const { busy, error, run } = useAsyncAction()

  if (device.state === 'this-device') return null

  const pausing = device.state !== 'paused'
  return (
    <div className="detail-panel__actions">
      <div className="detail-panel__action-row">
        <button
          className={pausing ? 'detail-panel__button--warning' : undefined}
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
        <button
          className="detail-panel__button--danger"
          disabled={busy}
          onClick={() =>
            run(
              `Remove ${device.name} as a peer from every registered node that has it configured? This can't be undone from here.`,
              () => mutations.removeDevice(device.id),
            )
          }
        >
          Remove device
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

/**
 * View/edit how the referencing nodes configure this device: name, addresses,
 * compression, introducer, auto-accept, rate limits. Loaded on demand (the
 * entries aren't in the model); applying writes the same options to every
 * referencing node, so a per-node divergence is called out before it gets
 * flattened.
 */
function DeviceOptionsSection({ device }: { device: Device }) {
  const { busy, error, run } = useAsyncAction()
  const [view, setView] = useState<DeviceOptionsView>()
  const [fields, setFields] = useState<DeviceOptionsFormFields>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()

  const load = () => {
    setLoading(true)
    setLoadError(undefined)
    mutations
      .getDeviceOptions(device.id)
      .then((result) => {
        setView(result)
        const first = result.nodes.find((n) => n.options !== undefined)
        setFields(first?.options !== undefined ? deviceOptionsFormFields(first.options) : undefined)
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  if (!view || !fields) {
    return (
      <div className="detail-panel__group">
        <div className="detail-panel__group-label">Device options</div>
        {view && <p>No registered node has this device configured.</p>}
        <div className="detail-panel__action-row">
          <button disabled={loading} onClick={load}>
            {loading ? 'Loading…' : view ? 'Reload' : 'Load device options'}
          </button>
        </div>
        {loadError && <div className="detail-panel__error">{loadError}</div>}
      </div>
    )
  }

  const differ = deviceOptionsDiffer(view.nodes)
  const readErrors = view.nodes.filter((n) => n.error !== undefined)

  const set = <K extends keyof DeviceOptionsFormFields>(key: K, value: DeviceOptionsFormFields[K]) =>
    setFields((prev) => (prev ? { ...prev, [key]: value } : prev))

  return (
    <div className="detail-panel__group">
      <div className="detail-panel__group-label">Device options</div>
      {differ && (
        <p className="detail-panel__status-errors">
          ⚠ Nodes configure this device differently — applying will set the values below on all of
          them.
        </p>
      )}
      <label className="detail-panel__action-row">
        Name:
        <input
          type="text"
          placeholder="(empty shows the device ID)"
          value={fields.name}
          disabled={busy}
          onChange={(event) => set('name', event.target.value)}
        />
      </label>
      <label className="detail-panel__action-row">
        Addresses (one per line):
        <textarea
          className="ignore-node__textarea"
          rows={2}
          spellCheck={false}
          placeholder="dynamic"
          value={fields.addressesText}
          disabled={busy}
          onChange={(event) => set('addressesText', event.target.value)}
        />
      </label>
      <label className="detail-panel__action-row">
        Compression:
        <select
          value={fields.compression}
          disabled={busy}
          onChange={(event) => set('compression', event.target.value)}
        >
          {[...new Set([...COMPRESSION_LEVELS, fields.compression])].map((level) => (
            <option key={level} value={level}>
              {level}
            </option>
          ))}
        </select>
      </label>
      <label className="detail-panel__action-row">
        <input
          type="checkbox"
          checked={fields.introducer}
          disabled={busy}
          onChange={(event) => set('introducer', event.target.checked)}
        />
        Introducer (may introduce its own peers to us)
      </label>
      <label className="detail-panel__action-row">
        <input
          type="checkbox"
          checked={fields.autoAcceptFolders}
          disabled={busy}
          onChange={(event) => set('autoAcceptFolders', event.target.checked)}
        />
        Auto-accept offered folders
      </label>
      <label className="detail-panel__action-row">
        Send limit (KiB/s, 0 = unlimited):
        <input
          type="number"
          min={0}
          value={fields.maxSendKbps}
          disabled={busy}
          onChange={(event) => set('maxSendKbps', event.target.value)}
        />
      </label>
      <label className="detail-panel__action-row">
        Receive limit (KiB/s, 0 = unlimited):
        <input
          type="number"
          min={0}
          value={fields.maxRecvKbps}
          disabled={busy}
          onChange={(event) => set('maxRecvKbps', event.target.value)}
        />
      </label>
      <div className="detail-panel__action-row">
        <button
          className="detail-panel__button--primary"
          disabled={busy || !deviceOptionsFieldsValid(fields)}
          onClick={() => {
            const nodeCount = view.nodes.filter((n) => n.options !== undefined).length
            run(
              `Apply these options for ${device.name} on ${nodeCount === 1 ? 'the 1 node' : `all ${nodeCount} nodes`} referencing it?`,
              () => mutations.setDeviceOptions(device.id, deviceOptionsFromFormFields(fields)),
            )
          }}
        >
          Apply options
        </button>
        <button className="detail-panel__link-button" disabled={loading || busy} onClick={load}>
          {loading ? 'Reloading…' : 'Reload'}
        </button>
      </div>
      {readErrors.map((n) => (
        <div className="detail-panel__error" key={n.nodeId}>
          {n.nodeId}: {n.error}
        </div>
      ))}
      {error && <div className="detail-panel__error">{error}</div>}
    </div>
  )
}

/**
 * Editor for one share's file-versioning config. Self-contained (its own
 * useAsyncAction) so its busy/error state is independent of the sibling
 * folder actions. Initialized once from `share.versioning`; the parent keys
 * it by that config so a change from the server (an SSE refresh) remounts it
 * with the new values rather than stranding the form on a stale config.
 */
function VersioningEditor({
  share,
  folderLabel,
  nodeName,
}: {
  share: Share
  folderLabel: string
  nodeName: string
}) {
  const { busy, error, run } = useAsyncAction()
  const current = share.versioning ?? { type: 'none' as VersioningType, params: {} }
  const [type, setType] = useState<VersioningType>(current.type)
  const [fields, setFields] = useState<Record<string, string>>(() => formFieldsFor(current.type, current))

  const selectType = (next: VersioningType) => {
    setType(next)
    setFields(formFieldsFor(next, current))
  }

  return (
    <div className="detail-panel__group">
      <div className="detail-panel__group-label">Versioning</div>
      <label className="detail-panel__action-row">
        Strategy:
        <select value={type} disabled={busy} onChange={(event) => selectType(event.target.value as VersioningType)}>
          {VERSIONING_TYPES.map((t) => (
            <option key={t} value={t}>
              {VERSIONING_TYPE_LABELS[t]}
            </option>
          ))}
        </select>
      </label>
      {VERSIONING_FIELDS[type].map((field) => (
        <label key={field.key} className="detail-panel__action-row">
          {field.label}
          <input
            type={field.kind === 'int' ? 'number' : 'text'}
            min={field.kind === 'int' ? 0 : undefined}
            placeholder={field.placeholder}
            value={fields[field.key] ?? ''}
            disabled={busy}
            onChange={(event) => setFields((prev) => ({ ...prev, [field.key]: event.target.value }))}
          />
        </label>
      ))}
      <div className="detail-panel__action-row">
        <button
          className="detail-panel__button--primary"
          disabled={busy || !versioningFieldsValid(type, fields)}
          onClick={() =>
            run(`Set versioning on "${folderLabel}" to ${VERSIONING_TYPE_LABELS[type]} for ${nodeName}?`, () =>
              mutations.setFolderVersioning(share.deviceId, share.folderId, {
                type,
                params: paramsFromFormFields(type, fields),
              }),
            )
          }
        >
          Apply versioning
        </button>
      </div>
      {error && <div className="detail-panel__error">{error}</div>}
    </div>
  )
}

/**
 * Editor for one share's advanced options (rescan interval, watcher, min disk
 * free). Same lifecycle as VersioningEditor: self-contained busy/error state,
 * initialized once from the share and remounted by the parent's key when the
 * server-side config changes.
 */
function AdvancedOptionsEditor({
  share,
  folderLabel,
  nodeName,
}: {
  share: Share
  folderLabel: string
  nodeName: string
}) {
  const { busy, error, run } = useAsyncAction()
  const [fields, setFields] = useState(() => advancedFormFields(share.advanced))

  return (
    <div className="detail-panel__group">
      <div className="detail-panel__group-label">Advanced</div>
      <label className="detail-panel__action-row">
        Rescan interval (s, 0 = off):
        <input
          type="number"
          min={0}
          value={fields.rescanIntervalS}
          disabled={busy}
          onChange={(event) => setFields((prev) => ({ ...prev, rescanIntervalS: event.target.value }))}
        />
      </label>
      <label className="detail-panel__action-row">
        <input
          type="checkbox"
          checked={fields.fsWatcherEnabled}
          disabled={busy}
          onChange={(event) => setFields((prev) => ({ ...prev, fsWatcherEnabled: event.target.checked }))}
        />
        Watch for changes
      </label>
      {fields.fsWatcherEnabled && (
        <label className="detail-panel__action-row">
          Watcher delay (s):
          <input
            type="number"
            min={1}
            value={fields.fsWatcherDelayS}
            disabled={busy}
            onChange={(event) => setFields((prev) => ({ ...prev, fsWatcherDelayS: event.target.value }))}
          />
        </label>
      )}
      <label className="detail-panel__action-row">
        Min disk free (0 = off):
        <input
          type="number"
          min={0}
          value={fields.minDiskFreeValue}
          disabled={busy}
          onChange={(event) => setFields((prev) => ({ ...prev, minDiskFreeValue: event.target.value }))}
        />
        <select
          value={fields.minDiskFreeUnit}
          disabled={busy}
          onChange={(event) => setFields((prev) => ({ ...prev, minDiskFreeUnit: event.target.value }))}
        >
          {/* The current unit joins the list even if it isn't one we'd offer —
              the model keeps units verbatim, so an exotic one must stay selectable
              rather than being silently swapped to '%'. */}
          {[...new Set([...MIN_DISK_FREE_UNITS, fields.minDiskFreeUnit])].map((unit) => (
            <option key={unit} value={unit}>
              {unit}
            </option>
          ))}
        </select>
      </label>
      <div className="detail-panel__action-row">
        <button
          className="detail-panel__button--primary"
          disabled={busy || !advancedFieldsValid(fields)}
          onClick={() =>
            run(`Apply advanced options for "${folderLabel}" on ${nodeName}?`, () =>
              mutations.setFolderAdvanced(share.deviceId, share.folderId, advancedFromFormFields(fields)),
            )
          }
        >
          Apply options
        </button>
      </div>
      {error && <div className="detail-panel__error">{error}</div>}
    </div>
  )
}

function ShareActions({ cluster, share }: { cluster: ClusterModel; share: Share }) {
  const { busy, error, run } = useAsyncAction()
  const [addTarget, setAddTarget] = useState('')
  const [addPassword, setAddPassword] = useState('')

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
            className={pausing ? 'detail-panel__button--warning' : undefined}
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
          {share.type === 'sendonly' && (
            <button
              className="detail-panel__button--warning"
              disabled={busy}
              onClick={() =>
                run(
                  `Override remote changes to "${folderLabel}"? ${nodeName}'s local version becomes the cluster's version — changes made on other devices are overwritten.`,
                  () => mutations.overrideFolder(share.deviceId, share.folderId),
                )
              }
            >
              Override changes
            </button>
          )}
          {share.type === 'receiveonly' && (
            <button
              className="detail-panel__button--danger"
              disabled={busy}
              onClick={() =>
                run(
                  `Revert local changes to "${folderLabel}" on ${nodeName}? Files changed or added locally are replaced with (or deleted in favor of) the cluster's version. This can't be undone.`,
                  () => mutations.revertFolder(share.deviceId, share.folderId),
                )
              }
            >
              Revert local changes
            </button>
          )}
          <button
            className="detail-panel__button--danger"
            disabled={busy}
            onClick={() =>
              run(
                `Remove folder "${folderLabel}" from ${nodeName}? This only affects this node — other nodes still sharing it are untouched. The data on disk is not deleted.`,
                () => mutations.removeFolder(share.deviceId, share.folderId),
              )
            }
          >
            Remove folder
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

      <VersioningEditor
        key={`${share.folderId}:${share.deviceId}:${share.versioning?.type ?? 'none'}:${JSON.stringify(share.versioning?.params ?? {})}`}
        share={share}
        folderLabel={folderLabel}
        nodeName={nodeName}
      />

      <AdvancedOptionsEditor
        key={`adv:${share.folderId}:${share.deviceId}:${JSON.stringify(share.advanced ?? null)}`}
        share={share}
        folderLabel={folderLabel}
        nodeName={nodeName}
      />

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
                    className="detail-panel__button--danger"
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
            <input
              type="password"
              placeholder="Encryption password (optional)"
              title="Set this to make the added peer untrusted/receiveencrypted — it will hold only ciphertext. Leave blank for a normal trusted share."
              value={addPassword}
              disabled={busy}
              onChange={(event) => setAddPassword(event.target.value)}
            />
            <button
              className="detail-panel__button--primary"
              disabled={busy || !addTarget}
              onClick={() => {
                const target = addTarget
                const password = addPassword
                const name = deviceById.get(target)?.name ?? target
                const message = password
                  ? `Share "${folderLabel}" with ${name} via ${nodeName} as an untrusted (receiveencrypted) peer?`
                  : `Share "${folderLabel}" with ${name} via ${nodeName}?`
                const started = run(message, () =>
                  mutations.addShare(share.deviceId, share.folderId, target, password || undefined),
                )
                if (started) {
                  setAddTarget('')
                  setAddPassword('')
                }
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

/**
 * View/edit each sharing node's `.stignore` patterns for a folder, plus a
 * cluster-level diff indicator. Loaded on demand (a button, not on mount) —
 * patterns aren't part of the model and can be large, so we only fetch them
 * when the user asks. Editing is per node; the diff banner is the novel
 * cluster-level bit a single-node GUI can't show.
 */
function IgnorePatternsSection({ cluster, folderId }: { cluster: ClusterModel; folderId: string }) {
  const { busy, error, run } = useAsyncAction()
  const [data, setData] = useState<FolderIgnores>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()
  const [drafts, setDrafts] = useState<Record<string, string>>({})

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))
  const folderLabel = cluster.folders.find((f) => f.id === folderId)?.label ?? folderId

  const load = () => {
    setLoading(true)
    setLoadError(undefined)
    mutations
      .getFolderIgnores(folderId)
      .then((result) => {
        setData(result)
        setDrafts(Object.fromEntries(result.nodes.map((n) => [n.deviceId, patternsToText(n.patterns)])))
      })
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  if (!data) {
    return (
      <div className="detail-panel__group">
        <div className="detail-panel__group-label">Ignore patterns</div>
        <div className="detail-panel__action-row">
          <button disabled={loading} onClick={load}>
            {loading ? 'Loading…' : 'Load ignore patterns'}
          </button>
        </div>
        {loadError && <div className="detail-panel__error">{loadError}</div>}
      </div>
    )
  }

  const differ = ignoresDiffer(data.nodes)
  const readable = data.nodes.filter((n) => n.error === undefined).length

  return (
    <div className="detail-panel__group">
      <div className="detail-panel__group-label">Ignore patterns</div>
      <p className={differ ? 'detail-panel__status-errors' : undefined}>
        {differ
          ? '⚠ Patterns differ across nodes'
          : readable > 1
            ? `✓ Identical across ${readable} nodes`
            : 'One node sharing this folder'}
        <button className="detail-panel__link-button" disabled={loading || busy} onClick={load}>
          {loading ? 'Reloading…' : 'Reload'}
        </button>
      </p>
      {data.nodes.length === 0 && <p>No nodes reported patterns for this folder.</p>}
      {data.nodes.map((node) => {
        const name = deviceById.get(node.deviceId)?.name ?? node.deviceId
        const draft = drafts[node.deviceId] ?? ''
        const dirty = JSON.stringify(textToPatterns(draft)) !== JSON.stringify(node.patterns)
        return (
          <div className="ignore-node" key={node.deviceId}>
            <div className="ignore-node__name">{name}</div>
            {node.error ? (
              <div className="detail-panel__error">{node.error}</div>
            ) : (
              <>
                <textarea
                  className="ignore-node__textarea"
                  rows={5}
                  spellCheck={false}
                  placeholder="# one pattern per line, e.g. *.tmp"
                  value={draft}
                  disabled={busy}
                  onChange={(event) =>
                    setDrafts((prev) => ({ ...prev, [node.deviceId]: event.target.value }))
                  }
                />
                <div className="detail-panel__action-row">
                  <button
                    className="detail-panel__button--primary"
                    disabled={busy || !dirty}
                    onClick={() => {
                      const patterns = textToPatterns(draft)
                      run(`Replace ignore patterns for "${folderLabel}" on ${name}?`, () =>
                        mutations.setFolderIgnores(node.deviceId, folderId, patterns).then(() => {
                          setData((prev) =>
                            prev
                              ? {
                                  ...prev,
                                  nodes: prev.nodes.map((n) =>
                                    n.deviceId === node.deviceId ? { ...n, patterns } : n,
                                  ),
                                }
                              : prev,
                          )
                        }),
                      )
                    }}
                  >
                    Save
                  </button>
                  {dirty && <span className="ignore-node__dirty">unsaved changes</span>}
                </div>
              </>
            )}
          </div>
        )
      })}
      {error && <div className="detail-panel__error">{error}</div>}
    </div>
  )
}

/**
 * On-demand "what's actually wrong" view for a folder: every sharing node's
 * failed pull items (the detail behind Share.failedItems) and its conflict
 * copies (`*.sync-conflict-*`). Behind a button like the ignore patterns —
 * the conflict scan walks each node's whole folder tree, which is far too
 * heavy to run on every selection, let alone every SSE frame.
 */
function ProblemsSection({ cluster, folderId }: { cluster: ClusterModel; folderId: string }) {
  const [data, setData] = useState<{ failed: FolderFailedItems; conflicts: FolderConflicts }>()
  const [loading, setLoading] = useState(false)
  const [loadError, setLoadError] = useState<string>()

  const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))

  const load = () => {
    setLoading(true)
    setLoadError(undefined)
    Promise.all([mutations.getFolderFailedItems(folderId), mutations.getFolderConflicts(folderId)])
      .then(([failed, conflicts]) => setData({ failed, conflicts }))
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))
      .finally(() => setLoading(false))
  }

  if (!data) {
    return (
      <div className="detail-panel__group">
        <div className="detail-panel__group-label">Conflicts & failed items</div>
        <div className="detail-panel__action-row">
          <button disabled={loading} onClick={load} title="Scans every sharing node's folder tree — can take a moment on large folders.">
            {loading ? 'Scanning…' : 'Scan for conflicts & failures'}
          </button>
        </div>
        {loadError && <div className="detail-panel__error">{loadError}</div>}
      </div>
    )
  }

  const totalFailed = data.failed.nodes.reduce((sum, n) => sum + n.items.length, 0)
  const totalConflicts = data.conflicts.nodes.reduce((sum, n) => sum + n.paths.length, 0)
  const readErrors = [
    ...data.failed.nodes.filter((n) => n.error !== undefined),
    ...data.conflicts.nodes.filter((n) => n.error !== undefined),
  ]

  return (
    <div className="detail-panel__group">
      <div className="detail-panel__group-label">Conflicts & failed items</div>
      <p className={totalFailed + totalConflicts > 0 ? 'detail-panel__status-errors' : undefined}>
        {totalFailed + totalConflicts > 0
          ? `${totalConflicts} conflict cop${totalConflicts === 1 ? 'y' : 'ies'}, ${totalFailed} failed item${totalFailed === 1 ? '' : 's'} across ${data.failed.nodes.length} node${data.failed.nodes.length === 1 ? '' : 's'}`
          : '✓ No conflicts or failed items on any node'}
        <button className="detail-panel__link-button" disabled={loading} onClick={load}>
          {loading ? 'Rescanning…' : 'Rescan'}
        </button>
      </p>
      {data.failed.nodes.map((node) => {
        const name = deviceById.get(node.deviceId)?.name ?? node.deviceId
        const conflicts = data.conflicts.nodes.find((n) => n.deviceId === node.deviceId)
        if (node.items.length === 0 && (conflicts?.paths.length ?? 0) === 0) return null
        return (
          <div className="ignore-node" key={node.deviceId}>
            <div className="ignore-node__name">{name}</div>
            {conflicts !== undefined && conflicts.paths.length > 0 && (
              <ul className="problems-list">
                {conflicts.paths.map((path) => (
                  <li key={path}>
                    <code>{path}</code>
                    <span className="problems-list__detail">conflict copy</span>
                  </li>
                ))}
              </ul>
            )}
            {node.items.length > 0 && (
              <ul className="problems-list">
                {node.items.map((item) => (
                  <li key={item.path}>
                    <code>{item.path}</code>
                    <span className="problems-list__detail">{item.error}</span>
                  </li>
                ))}
              </ul>
            )}
          </div>
        )
      })}
      {readErrors.map((n) => (
        <div className="detail-panel__error" key={n.deviceId}>
          {deviceById.get(n.deviceId)?.name ?? n.deviceId}: {n.error}
        </div>
      ))}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      className="copy-button"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true)
          setTimeout(() => setCopied(false), 1500)
        })
      }}
    >
      {copied ? 'Copied' : 'Copy'}
    </button>
  )
}

export function DetailPanel({ cluster, selection, onSelect, isLive }: DetailPanelProps) {
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
    const connections = connectionsByDevice(cluster, device.id)
    const deviceById = new Map(cluster.devices.map((d) => [d.id, d]))

    return (
      <aside className="detail-panel">
        <h3>{device.name}</h3>
        <p>
          <strong>State:</strong> {style.label}
        </p>
        <p>
          <strong>Device ID:</strong> <code>{device.id}</code>{' '}
          <CopyButton text={device.id} />
        </p>
        {device.systemStatus && <SystemStatusSection status={device.systemStatus} />}
        {isLive && <DeviceActions device={device} />}
        {/* Keyed by device so switching selection remounts the editor instead
            of carrying the previous device's loaded options over. */}
        {isLive && device.state !== 'this-device' && (
          <DeviceOptionsSection key={device.id} device={device} />
        )}
        {device.managed && <ConnectionsSection connections={connections} deviceById={deviceById} />}
        <h4>Folder shares ({shares.length})</h4>
        <ul className="attention-list">
          {shares.map((share) => {
            const typeStyle = FOLDER_TYPE_STYLE[share.type]
            const stateStyle = FOLDER_STATE_STYLE[share.state]
            const folder = folderById.get(share.folderId)
            return (
              <li key={share.folderId}>
                <button
                  className="attention-list__row"
                  onClick={() =>
                    onSelect({ kind: 'share', folderId: share.folderId, deviceId: device.id })
                  }
                >
                  <strong>{folder?.label ?? share.folderId}</strong>
                  <span className="attention-list__device">
                    {typeStyle.label}, {stateStyle.label}
                  </span>
                  {share.errorMessage && (
                    <span className="attention-list__message">{share.errorMessage}</span>
                  )}
                </button>
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
                {/* Keyed by the share so switching the selected folder remounts the
                    editor instead of carrying the previous folder's drafts over. */}
                {isLive && (
                  <ShareActions
                    key={`${share.folderId}:${share.deviceId}`}
                    cluster={cluster}
                    share={share}
                  />
                )}
              </section>
            )
          })}
        </div>
        {/* Keyed by folder: without it React reuses the instance across folder
            switches and the previous folder's loaded patterns/drafts would be
            shown — and saved — under the new folder's id. */}
        {isLive && <ProblemsSection key={`problems:${folder.id}`} cluster={cluster} folderId={folder.id} />}
        {isLive && <IgnorePatternsSection key={folder.id} cluster={cluster} folderId={folder.id} />}
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
      {share.versioning && (
        <p>
          <strong>Versioning:</strong> {describeVersioning(share.versioning)}
        </p>
      )}
      {share.advanced && (
        <p>
          <strong>Scanning:</strong> {describeAdvanced(share.advanced)}
        </p>
      )}
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
      {share.failedItems !== undefined && (
        <p className="detail-panel__status-errors">
          <strong>Failed items:</strong> {share.failedItems}
        </p>
      )}
      {share.errorMessage && (
        <p className="detail-panel__error">
          <strong>Error:</strong> {share.errorMessage}
        </p>
      )}
      {isLive && (
        <ShareActions
          key={`${share.folderId}:${share.deviceId}`}
          cluster={cluster}
          share={share}
        />
      )}
    </aside>
  )
}
