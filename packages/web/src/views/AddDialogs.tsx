import { useState, type ReactNode } from 'react'
import type { ClusterModel, FolderType } from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { useNodePicker, useSubmit } from './dialogHooks'
import * as mutations from '../data/mutations'

/**
 * The dialog itself is the confirmation/preview step CLAUDE.md requires:
 * an explicit form naming exactly which nodes the change lands on, applied
 * only on submit.
 */

interface DialogShellProps {
  title: string
  onClose: () => void
  children: ReactNode
}

export function DialogShell({ title, onClose, children }: DialogShellProps) {
  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" role="dialog" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <h3>{title}</h3>
        {children}
      </div>
    </div>
  )
}

/**
 * Registers a new Syncthing node with the proxy itself — distinct from
 * AddDeviceDialog, which adds an existing peer to already-registered nodes'
 * configs. This is the Phase 5 registration UI: the proxy persists the
 * result to cluster.json, so this replaces hand-editing that file for
 * anything beyond the first node or two.
 */
export function RegisterNodeDialog({ onClose }: { onClose: () => void }) {
  const [id, setId] = useState('')
  const [url, setUrl] = useState('')
  const [apiKey, setApiKey] = useState('')
  const { busy, error, submit } = useSubmit(onClose)

  const ready = id.trim() !== '' && url.trim() !== '' && apiKey.trim() !== ''

  return (
    <DialogShell title="Register node" onClose={onClose}>
      <label className="dialog__field">
        Node ID
        <input
          value={id}
          onChange={(e) => setId(e.target.value)}
          placeholder="st-a"
          title="An internal label for this node — doesn't need to match anything in Syncthing itself."
          autoFocus
        />
      </label>
      <label className="dialog__field">
        URL
        <input value={url} onChange={(e) => setUrl(e.target.value)} placeholder="http://127.0.0.1:8384" />
      </label>
      <label className="dialog__field">
        API key
        <input
          type="password"
          value={apiKey}
          onChange={(e) => setApiKey(e.target.value)}
          placeholder="Actions → Settings → GUI in that node's Syncthing UI"
        />
      </label>
      <p className="dialog__preview">
        {ready
          ? `Will connect to ${url.trim()} and register it as "${id.trim()}".`
          : 'Enter an id, URL, and API key for the node to register.'}
      </p>
      {error && <p className="dialog__error">{error}</p>}
      <div className="dialog__actions">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="dialog__primary"
          disabled={busy || !ready}
          onClick={() => submit(() => mutations.registerNode(id.trim(), url.trim(), apiKey.trim()))}
        >
          Register node
        </button>
      </div>
    </DialogShell>
  )
}

export function AddDeviceDialog({ cluster, onClose }: { cluster: ClusterModel; onClose: () => void }) {
  const [deviceId, setDeviceId] = useState('')
  const [name, setName] = useState('')
  const { managed, selected, picker } = useNodePicker(cluster)
  const { busy, error, submit } = useSubmit(onClose)

  const targetNames = managed.filter((d) => selected.includes(d.id)).map((d) => d.name)

  return (
    <DialogShell title="Add device" onClose={onClose}>
      <label className="dialog__field">
        Device ID
        <input
          value={deviceId}
          onChange={(e) => setDeviceId(e.target.value)}
          placeholder="XXXXXXX-XXXXXXX-…"
          autoFocus
        />
      </label>
      <label className="dialog__field">
        Name (optional)
        <input value={name} onChange={(e) => setName(e.target.value)} />
      </label>
      {picker}
      <p className="dialog__preview">
        {selected.length > 0 && deviceId
          ? `Will be added as a peer on: ${targetNames.join(', ')}`
          : 'Enter a device ID and pick at least one node.'}
      </p>
      {error && <p className="dialog__error">{error}</p>}
      <div className="dialog__actions">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="dialog__primary"
          disabled={busy || !deviceId || selected.length === 0}
          onClick={() => submit(() => mutations.addDevice(deviceId.trim(), name.trim(), selected))}
        >
          Add device
        </button>
      </div>
    </DialogShell>
  )
}

/** Same-type-everywhere creation; receiveencrypted is per-peer by nature, so not offered here. */
const CREATABLE_TYPES = (Object.keys(FOLDER_TYPE_STYLE) as FolderType[]).filter(
  (t) => t !== 'receiveencrypted',
)

export function AddFolderDialog({ cluster, onClose }: { cluster: ClusterModel; onClose: () => void }) {
  const [folderId, setFolderId] = useState('')
  const [label, setLabel] = useState('')
  const [path, setPath] = useState('')
  const [type, setType] = useState<FolderType>('sendreceive')
  const { managed, selected, picker } = useNodePicker(cluster)
  const { busy, error, submit } = useSubmit(onClose)

  const targetNames = managed.filter((d) => selected.includes(d.id)).map((d) => d.name)
  const effectivePath = path.trim() || (folderId ? `~/${folderId.trim()}` : '')

  return (
    <DialogShell title="Add folder" onClose={onClose}>
      <label className="dialog__field">
        Folder ID
        <input value={folderId} onChange={(e) => setFolderId(e.target.value)} autoFocus />
      </label>
      <label className="dialog__field">
        Label (optional)
        <input value={label} onChange={(e) => setLabel(e.target.value)} placeholder={folderId} />
      </label>
      <label className="dialog__field">
        Path on every node
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={effectivePath || '~/<folder id>'} />
      </label>
      <label className="dialog__field">
        Type
        <select value={type} onChange={(e) => setType(e.target.value as FolderType)}>
          {CREATABLE_TYPES.map((t) => (
            <option key={t} value={t}>
              {FOLDER_TYPE_STYLE[t].label}
            </option>
          ))}
        </select>
      </label>
      {picker}
      <p className="dialog__preview">
        {selected.length > 1 && folderId
          ? `Will be created at ${effectivePath} on ${targetNames.join(', ')}, shared among all of them.`
          : 'Enter a folder ID and pick at least two nodes to share it between.'}
      </p>
      {error && <p className="dialog__error">{error}</p>}
      <div className="dialog__actions">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="dialog__primary"
          disabled={busy || !folderId || selected.length < 2}
          onClick={() =>
            submit(() =>
              mutations.createFolder(
                {
                  folderId: folderId.trim(),
                  label: label.trim() || folderId.trim(),
                  path: effectivePath,
                  type,
                },
                selected,
              ),
            )
          }
        >
          Add folder
        </button>
      </div>
    </DialogShell>
  )
}
