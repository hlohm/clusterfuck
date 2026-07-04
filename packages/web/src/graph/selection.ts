import type { DeviceId, FolderId } from '@clusterfuck/shared'

export type Selection =
  | { kind: 'device'; deviceId: DeviceId }
  | { kind: 'folder'; folderId: FolderId }
  | { kind: 'share'; folderId: FolderId; deviceId: DeviceId }
  | null
