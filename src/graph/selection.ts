import type { DeviceId, FolderId } from '../model/types'

export type Selection =
  | { kind: 'device'; deviceId: DeviceId }
  | { kind: 'folder'; folderId: FolderId }
  | { kind: 'share'; folderId: FolderId; deviceId: DeviceId }
  | null
