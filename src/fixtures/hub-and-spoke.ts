import type { ClusterModel } from '../model/types'

/**
 * Six devices, three folders. `photos` is shared across four devices, which
 * is the fixture that proves the "3+ device" hyperedge case renders legibly
 * instead of turning into a pairwise-edge hairball.
 */
export const hubAndSpoke: ClusterModel = {
  id: 'hub-and-spoke',
  label: 'Hub and spoke (6 devices, shared photos folder)',
  devices: [
    { id: 'device-hub', name: 'hub-server', state: 'this-device' },
    { id: 'device-phone', name: 'phone', state: 'connected' },
    { id: 'device-tablet', name: 'tablet', state: 'connected' },
    { id: 'device-laptop', name: 'laptop', state: 'connected' },
    { id: 'device-nas', name: 'nas', state: 'connected' },
    { id: 'device-kiosk', name: 'lobby-kiosk', state: 'connected' },
  ],
  folders: [
    { id: 'photos', label: 'photos' },
    { id: 'notes', label: 'notes' },
    { id: 'archive', label: 'archive' },
  ],
  shares: [
    // photos: shared by 4 devices, mixed types/states
    { folderId: 'photos', deviceId: 'device-hub', type: 'sendreceive', state: 'idle' },
    {
      folderId: 'photos',
      deviceId: 'device-phone',
      type: 'sendonly',
      state: 'syncing',
      completionPct: 42,
    },
    { folderId: 'photos', deviceId: 'device-tablet', type: 'sendonly', state: 'idle' },
    {
      folderId: 'photos',
      deviceId: 'device-nas',
      type: 'receiveonly',
      state: 'scanning',
    },

    // notes: two-device sendreceive pair
    { folderId: 'notes', deviceId: 'device-hub', type: 'sendreceive', state: 'idle' },
    { folderId: 'notes', deviceId: 'device-laptop', type: 'sendreceive', state: 'idle' },

    // archive: hub pushes to a read-only kiosk display
    { folderId: 'archive', deviceId: 'device-hub', type: 'sendonly', state: 'idle' },
    { folderId: 'archive', deviceId: 'device-kiosk', type: 'receiveonly', state: 'idle' },
  ],
}
