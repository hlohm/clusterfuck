import type { ClusterModel } from './types.ts'

export interface ValidationError {
  message: string
}

export function validateCluster(cluster: ClusterModel): ValidationError[] {
  const errors: ValidationError[] = []

  const deviceIds = new Set(cluster.devices.map((d) => d.id))
  const folderIds = new Set(cluster.folders.map((f) => f.id))
  const seenPairs = new Set<string>()

  for (const share of cluster.shares) {
    if (!deviceIds.has(share.deviceId)) {
      errors.push({ message: `Share references unknown device "${share.deviceId}"` })
    }
    if (!folderIds.has(share.folderId)) {
      errors.push({ message: `Share references unknown folder "${share.folderId}"` })
    }

    for (const sharedId of share.sharedWith) {
      if (!deviceIds.has(sharedId)) {
        errors.push({
          message: `Share "${share.folderId}"/"${share.deviceId}" lists unknown device "${sharedId}" in sharedWith`,
        })
      }
    }
    if (!share.sharedWith.includes(share.deviceId)) {
      errors.push({
        message: `Share "${share.folderId}"/"${share.deviceId}" is missing its own device in sharedWith`,
      })
    }

    const pairKey = `${share.folderId}::${share.deviceId}`
    if (seenPairs.has(pairKey)) {
      errors.push({
        message: `Duplicate share for folder "${share.folderId}" and device "${share.deviceId}"`,
      })
    }
    seenPairs.add(pairKey)
  }

  return errors
}

export function assertValidCluster(cluster: ClusterModel): void {
  const errors = validateCluster(cluster)
  if (errors.length > 0) {
    throw new Error(
      `Invalid cluster "${cluster.id}":\n${errors.map((e) => `  - ${e.message}`).join('\n')}`,
    )
  }
}
