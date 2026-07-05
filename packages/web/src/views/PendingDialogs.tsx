import { useState } from 'react'
import type { ClusterModel, FolderType, PendingDevice } from '@clusterfuck/shared'
import { FOLDER_TYPE_STYLE } from '../encoding/folderTypeStyle'
import { DialogShell } from './AddDialogs'
import { useNodePicker, useSubmit } from './dialogHooks'
import * as mutations from '../data/mutations'

/** receiveencrypted needs a password derived per-share, not offered here — same as AddFolderDialog. */
const CREATABLE_TYPES = (Object.keys(FOLDER_TYPE_STYLE) as FolderType[]).filter(
  (t) => t !== 'receiveencrypted',
)

export function AcceptPendingDeviceDialog({
  cluster,
  pending,
  onClose,
}: {
  cluster: ClusterModel
  pending: PendingDevice
  onClose: () => void
}) {
  const [name, setName] = useState(pending.name ?? '')
  const { managed, selected, picker } = useNodePicker(cluster)
  const { busy, error, submit } = useSubmit(onClose)

  const targetNames = managed.filter((d) => selected.includes(d.id)).map((d) => d.name)

  return (
    <DialogShell title="Accept pending device" onClose={onClose}>
      <p className="dialog__preview">
        <code>{pending.deviceId}</code>
      </p>
      <label className="dialog__field">
        Name (optional)
        <input value={name} onChange={(e) => setName(e.target.value)} autoFocus />
      </label>
      {picker}
      <p className="dialog__preview">
        {selected.length > 0
          ? `Will be added as a peer on: ${targetNames.join(', ')}`
          : 'Pick at least one node.'}
      </p>
      {error && <p className="dialog__error">{error}</p>}
      <div className="dialog__actions">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="dialog__primary"
          disabled={busy || selected.length === 0}
          onClick={() =>
            submit(() => mutations.acceptPendingDevice(pending.deviceId, name.trim(), selected))
          }
        >
          Accept
        </button>
      </div>
    </DialogShell>
  )
}

export interface PendingFolderOffer {
  nodeId: string
  offeredBy: string
  label: string
  /** The offering device sent this to be stored as ciphertext — our side must accept it as receiveencrypted, not any other type. */
  receiveEncrypted: boolean
}

export function AcceptPendingFolderDialog({
  folderId,
  offer,
  onClose,
}: {
  folderId: string
  offer: PendingFolderOffer
  onClose: () => void
}) {
  const [label, setLabel] = useState(offer.label || folderId)
  const [path, setPath] = useState('')
  const [type, setType] = useState<FolderType>(offer.receiveEncrypted ? 'receiveencrypted' : 'sendreceive')
  const { busy, error, submit } = useSubmit(onClose)

  const effectivePath = path.trim() || `~/${folderId}`

  return (
    <DialogShell title="Accept pending folder" onClose={onClose}>
      <p className="dialog__preview">
        Offered by <code>{offer.offeredBy}</code>
      </p>
      <label className="dialog__field">
        Label
        <input value={label} onChange={(e) => setLabel(e.target.value)} autoFocus />
      </label>
      <label className="dialog__field">
        Path
        <input value={path} onChange={(e) => setPath(e.target.value)} placeholder={effectivePath} />
      </label>
      <label className="dialog__field">
        Type
        <select
          value={type}
          disabled={offer.receiveEncrypted}
          title={
            offer.receiveEncrypted
              ? 'This was sent to be stored as ciphertext — it can only be accepted as receiveencrypted'
              : undefined
          }
          onChange={(e) => setType(e.target.value as FolderType)}
        >
          {offer.receiveEncrypted ? (
            <option value="receiveencrypted">{FOLDER_TYPE_STYLE.receiveencrypted.label}</option>
          ) : (
            CREATABLE_TYPES.map((t) => (
              <option key={t} value={t}>
                {FOLDER_TYPE_STYLE[t].label}
              </option>
            ))
          )}
        </select>
      </label>
      <p className="dialog__preview">Will be joined at {effectivePath}.</p>
      {error && <p className="dialog__error">{error}</p>}
      <div className="dialog__actions">
        <button onClick={onClose} disabled={busy}>
          Cancel
        </button>
        <button
          className="dialog__primary"
          disabled={busy}
          onClick={() =>
            submit(() =>
              mutations.acceptPendingFolder(offer.nodeId, folderId, {
                offeredBy: offer.offeredBy,
                label: label.trim() || folderId,
                path: effectivePath,
                type,
              }),
            )
          }
        >
          Accept
        </button>
      </div>
    </DialogShell>
  )
}
