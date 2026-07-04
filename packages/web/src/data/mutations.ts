import type { FolderType } from '@clusterfuck/shared'
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

export function addShare(deviceId: string, folderId: string, shareDeviceId: string): Promise<void> {
  return call(
    'POST',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/shares`,
    { deviceId: shareDeviceId },
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
