import type { ClusterModel } from '@clusterfuck/shared'

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
    {
      folderId: 'ledger',
      deviceId: 'device-origin',
      type: 'sendreceive',
      state: 'idle',
      sharedWith: ['device-origin', 'device-mirror', 'device-satellite', 'device-vault'],
    },
    {
      folderId: 'ledger',
      deviceId: 'device-mirror',
      type: 'sendonly',
      state: 'out-of-sync',
      outOfSyncItems: 12,
      sharedWith: ['device-origin', 'device-mirror', 'device-satellite', 'device-vault'],
    },
    {
      folderId: 'ledger',
      deviceId: 'device-satellite',
      type: 'receiveonly',
      state: 'error',
      errorMessage: 'disk full: no space to write incoming files',
      sharedWith: ['device-origin', 'device-mirror', 'device-satellite', 'device-vault'],
    },
    {
      folderId: 'ledger',
      deviceId: 'device-vault',
      type: 'receiveonly',
      state: 'paused',
      sharedWith: ['device-origin', 'device-mirror', 'device-satellite', 'device-vault'],
    },

    // coldstore: mutual encrypted relay between two untrusted peers
    {
      folderId: 'coldstore',
      deviceId: 'device-relay-a',
      type: 'receiveencrypted',
      state: 'syncing',
      completionPct: 63,
      sharedWith: ['device-relay-a', 'device-relay-b'],
    },
    {
      folderId: 'coldstore',
      deviceId: 'device-relay-b',
      type: 'receiveencrypted',
      state: 'idle',
      sharedWith: ['device-relay-a', 'device-relay-b'],
    },
  ],
}
