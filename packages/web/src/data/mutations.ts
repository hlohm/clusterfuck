import type { FolderType } from '@clusterfuck/shared'

const PROXY_BASE = import.meta.env.VITE_PROXY_URL ?? ''

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
