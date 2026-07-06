import type { ClusterModel } from '@clusterfuck/shared'

/**
 * Three devices, one folder: two trusted peers syncing plaintext, plus one
 * untrusted receiveencrypted peer that both trusted peers relay ciphertext
 * to. Smallest cluster that still exercises a receiveencrypted node.
 */
export const smallMirror: ClusterModel = {
  id: 'small-mirror',
  label: 'Small mirror (2 trusted, 1 encrypted)',
  devices: [
    { id: 'device-alpha', name: 'alpha-laptop', state: 'this-device', managed: true },
    { id: 'device-bravo', name: 'bravo-desktop', state: 'connected', managed: true },
    { id: 'device-charlie', name: 'charlie-backup', state: 'connected', managed: true },
  ],
  folders: [{ id: 'spectrum', label: 'spectrum' }],
  shares: [
    {
      folderId: 'spectrum',
      deviceId: 'device-alpha',
      type: 'sendreceive',
      state: 'idle',
      versioning: { type: 'staggered', params: { maxAge: String(30 * 86400) } },
      sharedWith: ['device-alpha', 'device-bravo', 'device-charlie'],
    },
    {
      folderId: 'spectrum',
      deviceId: 'device-bravo',
      type: 'sendreceive',
      state: 'idle',
      versioning: { type: 'simple', params: { keep: '5', cleanoutDays: '0' } },
      sharedWith: ['device-alpha', 'device-bravo', 'device-charlie'],
    },
    {
      folderId: 'spectrum',
      deviceId: 'device-charlie',
      type: 'receiveencrypted',
      state: 'syncing',
      completionPct: 87,
      sharedWith: ['device-alpha', 'device-bravo', 'device-charlie'],
    },
  ],
  connections: [],
  pendingDevices: [],
  pendingFolders: [],
}
