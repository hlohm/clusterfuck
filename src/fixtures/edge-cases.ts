import type { ClusterModel } from '../model/types'

/**
 * Exercises states the other fixtures don't hit organically: a paused
 * device, a disconnected device, a folder in error, and an out-of-sync
 * sendonly share (out-of-sync by design, not a bug). Also includes a second
 * receiveencrypted pairing so the encrypted-relay case isn't a one-off.
 */
export const edgeCases: ClusterModel = {
  id: 'edge-cases',
  label: 'Edge cases (paused, error, out-of-sync, encrypted relay)',
  devices: [
    { id: 'device-origin', name: 'origin', state: 'this-device' },
    { id: 'device-mirror', name: 'mirror', state: 'connected' },
    { id: 'device-satellite', name: 'satellite', state: 'disconnected' },
    { id: 'device-vault', name: 'vault', state: 'paused' },
    { id: 'device-relay-a', name: 'relay-a', state: 'connected' },
    { id: 'device-relay-b', name: 'relay-b', state: 'connected' },
  ],
  folders: [
    { id: 'ledger', label: 'ledger' },
    { id: 'coldstore', label: 'coldstore' },
  ],
  shares: [
    { folderId: 'ledger', deviceId: 'device-origin', type: 'sendreceive', state: 'idle' },
    {
      folderId: 'ledger',
      deviceId: 'device-mirror',
      type: 'sendonly',
      state: 'out-of-sync',
      outOfSyncItems: 12,
    },
    {
      folderId: 'ledger',
      deviceId: 'device-satellite',
      type: 'receiveonly',
      state: 'error',
      errorMessage: 'disk full: no space to write incoming files',
    },
    { folderId: 'ledger', deviceId: 'device-vault', type: 'receiveonly', state: 'paused' },

    // coldstore: mutual encrypted relay between two untrusted peers
    {
      folderId: 'coldstore',
      deviceId: 'device-relay-a',
      type: 'receiveencrypted',
      state: 'syncing',
      completionPct: 63,
    },
    { folderId: 'coldstore', deviceId: 'device-relay-b', type: 'receiveencrypted', state: 'idle' },
  ],
}
