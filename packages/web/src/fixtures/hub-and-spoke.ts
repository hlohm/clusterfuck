import type { ClusterModel } from '@clusterfuck/shared'

/**
 * Six devices, three folders. `photos` is shared across four devices, which
 * is the fixture that proves the "3+ device" hyperedge case renders legibly
 * instead of turning into a pairwise-edge hairball.
 */
export const hubAndSpoke: ClusterModel = {
  id: 'hub-and-spoke',
  label: 'Hub and spoke (6 devices, shared photos folder)',
  devices: [
    { id: 'device-hub', name: 'hub-server', state: 'this-device', managed: true },
    { id: 'device-phone', name: 'phone', state: 'connected', managed: true },
    { id: 'device-tablet', name: 'tablet', state: 'connected', managed: true },
    { id: 'device-laptop', name: 'laptop', state: 'connected', managed: true },
    { id: 'device-nas', name: 'nas', state: 'connected', managed: true },
    { id: 'device-kiosk', name: 'lobby-kiosk', state: 'connected', managed: true },
  ],
  folders: [
    { id: 'photos', label: 'photos' },
    { id: 'notes', label: 'notes' },
    { id: 'archive', label: 'archive' },
  ],
  shares: [
    // photos: shared by 4 devices, mixed types/states
    {
      folderId: 'photos',
      deviceId: 'device-hub',
      type: 'sendreceive',
      state: 'idle',
      sharedWith: ['device-hub', 'device-phone', 'device-tablet', 'device-nas'],
    },
    {
      folderId: 'photos',
      deviceId: 'device-phone',
      type: 'sendonly',
      state: 'syncing',
      completionPct: 42,
      sharedWith: ['device-hub', 'device-phone', 'device-tablet', 'device-nas'],
    },
    {
      folderId: 'photos',
      deviceId: 'device-tablet',
      type: 'sendonly',
      state: 'idle',
      sharedWith: ['device-hub', 'device-phone', 'device-tablet', 'device-nas'],
    },
    {
      folderId: 'photos',
      deviceId: 'device-nas',
      type: 'receiveonly',
      state: 'scanning',
      sharedWith: ['device-hub', 'device-phone', 'device-tablet', 'device-nas'],
    },

    // notes: two-device sendreceive pair
    {
      folderId: 'notes',
      deviceId: 'device-hub',
      type: 'sendreceive',
      state: 'idle',
      sharedWith: ['device-hub', 'device-laptop'],
    },
    {
      folderId: 'notes',
      deviceId: 'device-laptop',
      type: 'sendreceive',
      state: 'idle',
      sharedWith: ['device-hub', 'device-laptop'],
    },

    // archive: hub pushes to a read-only kiosk display
    {
      folderId: 'archive',
      deviceId: 'device-hub',
      type: 'sendonly',
      state: 'idle',
      sharedWith: ['device-hub', 'device-kiosk'],
    },
    {
      folderId: 'archive',
      deviceId: 'device-kiosk',
      type: 'receiveonly',
      state: 'idle',
      sharedWith: ['device-hub', 'device-kiosk'],
    },
  ],
}
