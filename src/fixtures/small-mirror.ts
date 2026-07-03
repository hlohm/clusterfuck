import type { ClusterModel } from '../model/types'

/**
 * Three devices, one folder: two trusted peers syncing plaintext, plus one
 * untrusted receiveencrypted peer that both trusted peers relay ciphertext
 * to. Smallest cluster that still exercises a receiveencrypted node.
 */
export const smallMirror: ClusterModel = {
  id: 'small-mirror',
  label: 'Small mirror (2 trusted, 1 encrypted)',
  devices: [
    { id: 'device-alpha', name: 'alpha-laptop', state: 'this-device' },
    { id: 'device-bravo', name: 'bravo-desktop', state: 'connected' },
    { id: 'device-charlie', name: 'charlie-backup', state: 'connected' },
  ],
  folders: [{ id: 'spectrum', label: 'spectrum' }],
  shares: [
    { folderId: 'spectrum', deviceId: 'device-alpha', type: 'sendreceive', state: 'idle' },
    { folderId: 'spectrum', deviceId: 'device-bravo', type: 'sendreceive', state: 'idle' },
    {
      folderId: 'spectrum',
      deviceId: 'device-charlie',
      type: 'receiveencrypted',
      state: 'syncing',
      completionPct: 87,
    },
  ],
}
