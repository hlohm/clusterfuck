import type { FolderType, VersioningType } from '@clusterfuck/shared'
import { PROXY_BASE } from './proxyBase'

async function call(method: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method,
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    throw new Error(data?.error ?? `${method} ${path} failed (HTTP ${res.status})`)
  }
}

/** Pauses/resumes every registered node's connection to this device. */
export function setDevicePaused(deviceId: string, paused: boolean): Promise<void> {
  return call('POST', `/api/devices/${encodeURIComponent(deviceId)}/${paused ? 'pause' : 'resume'}`)
}

/** Cluster-wide: pauses/resumes every device on every registered node. */
export function setAllDevicesPaused(paused: boolean): Promise<void> {
  return call('POST', `/api/devices/all/${paused ? 'pause' : 'resume'}`)
}

/** Cluster-wide: pauses/resumes every folder on every registered node. */
export function setAllFoldersPaused(paused: boolean): Promise<void> {
  return call('POST', `/api/folders/all/${paused ? 'pause' : 'resume'}`)
}

/** Registers a new node with the proxy, persisted server-side (cluster.json). */
export function registerNode(id: string, url: string, apiKey: string): Promise<void> {
  return call('POST', '/api/nodes', { id, url, apiKey })
}

/** De-registers a node from the proxy. Doesn't touch its own Syncthing config or unlink it as a peer elsewhere. */
export function removeNode(nodeId: string): Promise<void> {
  return call('DELETE', `/api/nodes/${encodeURIComponent(nodeId)}`)
}

/** Adds a device as a peer in each named registered node's config. */
export function addDevice(deviceId: string, name: string, nodes: string[]): Promise<void> {
  return call('POST', '/api/devices', { deviceId, name: name || undefined, nodes })
}

/** Removes a device as a peer from every registered node that has it configured. */
export function removeDevice(deviceId: string): Promise<void> {
  return call('DELETE', `/api/devices/${encodeURIComponent(deviceId)}`)
}

/** Creates a folder on each named registered node, shared among all of them. */
export function createFolder(
  spec: { folderId: string; label: string; path: string; type: FolderType },
  devices: string[],
): Promise<void> {
  return call('POST', '/api/folders', { ...spec, devices })
}

/** `deviceId` is the registered node whose folder config this edits (a Share's own deviceId). */
export function setFolderPaused(deviceId: string, folderId: string, paused: boolean): Promise<void> {
  return call(
    'POST',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/${paused ? 'pause' : 'resume'}`,
  )
}

export function rescanFolder(deviceId: string, folderId: string): Promise<void> {
  return call(
    'POST',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/rescan`,
  )
}

export function setFolderType(deviceId: string, folderId: string, type: FolderType): Promise<void> {
  return call(
    'PATCH',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}`,
    { type },
  )
}

/** Sets this folder's file-versioning config on one node; `type: 'none'` turns versioning off. */
export function setFolderVersioning(
  deviceId: string,
  folderId: string,
  spec: { type: VersioningType; params: Record<string, string>; cleanupIntervalS?: number },
): Promise<void> {
  return call(
    'PUT',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/versioning`,
    spec,
  )
}

/**
 * `encryptionPassword`, if set, makes shareDeviceId untrusted/receiveencrypted
 * on its own side. Also doubles as "set/change the password on an
 * already-shared device" — omit it to leave an existing password untouched.
 */
export function addShare(
  deviceId: string,
  folderId: string,
  shareDeviceId: string,
  encryptionPassword?: string,
): Promise<void> {
  return call(
    'POST',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/shares`,
    { deviceId: shareDeviceId, encryptionPassword },
  )
}

export function removeShare(deviceId: string, folderId: string, shareDeviceId: string): Promise<void> {
  return call(
    'DELETE',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/shares/${encodeURIComponent(shareDeviceId)}`,
  )
}

/** Removes the folder from this one node's config only — not cluster-wide. */
export function removeFolder(deviceId: string, folderId: string): Promise<void> {
  return call(
    'DELETE',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}`,
  )
}

/** Configures a pending device as a peer on the named nodes — identical effect to addDevice. */
export function acceptPendingDevice(deviceId: string, name: string, nodes: string[]): Promise<void> {
  return call('POST', `/api/pending/devices/${encodeURIComponent(deviceId)}/accept`, {
    name: name || undefined,
    nodes,
  })
}

/** Dismisses a pending device on every registered node currently reporting it. Not permanent. */
export function dismissPendingDevice(deviceId: string): Promise<void> {
  return call('DELETE', `/api/pending/devices/${encodeURIComponent(deviceId)}`)
}

/** Joins a pending folder on one node, shared with the peer that offered it. */
export function acceptPendingFolder(
  nodeId: string,
  folderId: string,
  spec: { offeredBy: string; label: string; path: string; type: FolderType },
): Promise<void> {
  return call(
    'POST',
    `/api/pending/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(nodeId)}/accept`,
    spec,
  )
}

/** Dismisses a pending folder offer on one node; `offeredBy` narrows to one offering device. */
export function dismissPendingFolder(nodeId: string, folderId: string, offeredBy?: string): Promise<void> {
  const query = offeredBy ? `?offeredBy=${encodeURIComponent(offeredBy)}` : ''
  return call(
    'DELETE',
    `/api/pending/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(nodeId)}${query}`,
  )
}
