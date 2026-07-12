import type { ClusterModel } from '@clusterfuck/shared'

/**
 * Exercises states the other fixtures don't hit organically: a paused
 * device, a disconnected device, a folder in error, and an out-of-sync
 * sendonly share (out-of-sync by design, not a bug). Also includes a second
 * receiveencrypted pairing so the encrypted-relay case isn't a one-off, and
 * two deliberate config-drift examples on the ledger folder (a divergent
 * label on mirror, and vault not sharing back with mirror/satellite) so the
 * Overview's drift section is explorable without a live cluster.
 */
export const edgeCases: ClusterModel = {
  id: 'edge-cases',
  label: 'Edge cases (paused, error, out-of-sync, encrypted relay)',
  devices: [
    {
      id: 'device-origin',
      name: 'origin',
      state: 'this-device',
      managed: true,
      systemStatus: {
        version: 'v1.27.3',
        uptimeSeconds: 254_612,
        ramBytes: 84_500_000,
        listeners: { total: 2, ok: 2, errors: [] },
        discovery: { total: 2, ok: 2, errors: [] },
      },
    },
    { id: 'device-mirror', name: 'mirror', state: 'connected', managed: true },
    { id: 'device-satellite', name: 'satellite', state: 'disconnected', managed: true },
    { id: 'device-vault', name: 'vault', state: 'paused', managed: true },
    { id: 'device-relay-a', name: 'relay-a', state: 'connected', managed: true },
    {
      id: 'device-relay-b',
      name: 'relay-b',
      state: 'connected',
      managed: true,
      // A live systemStatus example with a failing listener — exercises the
      // "not everything is OK" rendering path, not just the all-healthy one.
      // Deliberately Syncthing 2.x while origin reports 1.x: that makes this
      // a mixed-major cluster (ROADMAP "Syncthing 2.x support"), keeping the
      // mixed-cluster hint and per-node version chips explorable.
      systemStatus: {
        version: 'v2.0.4',
        uptimeSeconds: 900,
        ramBytes: 41_200_000,
        listeners: { total: 3, ok: 2, errors: ['relay://relays.syncthing.net: dial tcp: connection refused'] },
        discovery: { total: 2, ok: 2, errors: [] },
      },
    },
    // Known only from other nodes' configs — appears in the topology but has
    // no first-hand Share rows and can't be managed directly.
    { id: 'device-roamer', name: 'roamer (unmanaged)', state: 'disconnected', managed: false },
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
      // Syncthing's stock defaults — the common case the editor starts from.
      advanced: {
        rescanIntervalS: 3600,
        fsWatcherEnabled: true,
        fsWatcherDelayS: 10,
        minDiskFree: { value: 1, unit: '%' },
      },
      sharedWith: ['device-origin', 'device-mirror', 'device-satellite', 'device-vault'],
    },
    {
      folderId: 'ledger',
      deviceId: 'device-mirror',
      // Deliberate label drift: mirror calls the folder something else.
      label: 'Ledger (main)',
      type: 'sendonly',
      state: 'out-of-sync',
      outOfSyncItems: 12,
      // Watcher off + periodic rescan off + a sized (non-%) free-space floor —
      // the fully-manual configuration every field of the editor must render.
      advanced: {
        rescanIntervalS: 0,
        fsWatcherEnabled: false,
        fsWatcherDelayS: 10,
        minDiskFree: { value: 500, unit: 'MB' },
      },
      sharedWith: ['device-origin', 'device-mirror', 'device-satellite', 'device-vault'],
    },
    {
      folderId: 'ledger',
      deviceId: 'device-satellite',
      type: 'receiveonly',
      state: 'error',
      errorMessage: 'disk full: no space to write incoming files',
      failedItems: 3,
      sharedWith: ['device-origin', 'device-mirror', 'device-satellite', 'device-vault'],
    },
    {
      folderId: 'ledger',
      deviceId: 'device-vault',
      type: 'receiveonly',
      state: 'paused',
      // Deliberate asymmetry: mirror and satellite share with vault, but
      // vault only shares back with origin — two drift warnings.
      sharedWith: ['device-origin', 'device-vault'],
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
  connections: [
    // A live link mid-transfer: cumulative totals plus a current rate (the
    // proxy estimates inBps/outBps from counter deltas between refreshes).
    { deviceId: 'device-origin', peerId: 'device-mirror', connected: true, inBytesTotal: 128_500_000, outBytesTotal: 340_200_000, inBps: 356_000, outBps: 1_240_000 },
    // A disconnected peer's totals are 0, not stale nonzero data: Syncthing's
    // own connection stats only populate while a connection is live (see
    // Connection's doc comment) — a disconnected row keeping old bytes isn't
    // a state a real node can report.
    { deviceId: 'device-origin', peerId: 'device-satellite', connected: false, inBytesTotal: 0, outBytesTotal: 0 },
    { deviceId: 'device-origin', peerId: 'device-vault', connected: false, inBytesTotal: 0, outBytesTotal: 0 },
  ],
  pendingDevices: [
    {
      deviceId: 'PENDING-DEVICE-1',
      name: 'new-phone',
      seenOn: [
        { nodeId: 'device-origin', time: '2026-07-04T10:00:00Z', address: '192.168.1.42:22000' },
        { nodeId: 'device-mirror', time: '2026-07-04T10:05:00Z', address: '192.168.1.42:22000' },
      ],
    },
  ],
  pendingFolders: [
    {
      folderId: 'shared-recipes',
      label: 'Recipes',
      offers: [
        {
          nodeId: 'device-origin',
          offeredBy: 'device-relay-a',
          time: '2026-07-04T09:30:00Z',
          label: 'Recipes',
          receiveEncrypted: false,
        },
      ],
    },
    // An encrypted offer — accepting it must lock the type to receiveencrypted, not default to sendreceive.
    {
      folderId: 'vault-backup',
      label: 'Vault backup',
      offers: [
        {
          nodeId: 'device-mirror',
          offeredBy: 'device-relay-b',
          time: '2026-07-04T09:45:00Z',
          label: 'Vault backup',
          receiveEncrypted: true,
        },
      ],
    },
  ],
}
