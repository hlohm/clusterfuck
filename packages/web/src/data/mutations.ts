import type {
  BandwidthLimitsView,
  CompletionHistoryView,
  DeviceOptions,
  EventLogView,
  DeviceOptionsView,
  FolderAdvancedOptions,
  FolderConflicts,
  FolderFailedItems,
  FolderIgnores,
  FolderType,
  RecentChangesView,
  UpgradeRun,
  VersioningType,
} from '@clusterfuck/shared'
import { PROXY_BASE } from './proxyBase'

// credentials: 'include' carries the auth session cookie even when the proxy
// is on another origin (a no-op same-origin, where cookies flow by default).
async function call(method: string, path: string, body?: unknown): Promise<void> {
  const res = await fetch(`${PROXY_BASE}${path}`, {
    method,
    credentials: 'include',
    headers: body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const data = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    throw new Error(data?.error ?? `${method} ${path} failed (HTTP ${res.status})`)
  }
}

/** GET variant of `call` for the few routes that return data, not just `{ ok }`. */
async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${PROXY_BASE}${path}`, { credentials: 'include' })
  if (!res.ok) {
    const data = (await res.json().catch(() => undefined)) as { error?: string } | undefined
    throw new Error(data?.error ?? `GET ${path} failed (HTTP ${res.status})`)
  }
  return (await res.json()) as T
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

/** Cluster-wide: triggers a rescan of every folder on every registered node. */
export function rescanAllFolders(): Promise<void> {
  return call('POST', '/api/folders/all/rescan')
}

/** The merged raw event log, newest first (bounded, in-memory). Filtering is done client-side; the API also accepts ?types/?node/?limit. */
export function getEventLog(): Promise<EventLogView> {
  return getJson('/api/events/log')
}

/** Recent per-share completion samples — the overview sparklines' data (bounded, in-memory on the proxy). */
export function getCompletionHistory(): Promise<CompletionHistoryView> {
  return getJson('/api/history/completion')
}

/** The merged recent-changes feed, newest first (bounded, in-memory on the proxy). */
export function getRecentChanges(): Promise<RecentChangesView> {
  return getJson('/api/changes')
}

/** Every registered node's global bandwidth limits (KiB/s, 0 = unlimited). */
export function getBandwidthLimits(): Promise<BandwidthLimitsView> {
  return getJson('/api/bandwidth')
}

/** Sets global bandwidth limits on one node, or on every registered node when nodeId is undefined. */
export function setBandwidthLimits(
  nodeId: string | undefined,
  limits: { maxSendKbps: number; maxRecvKbps: number },
): Promise<void> {
  const path = nodeId === undefined ? '/api/bandwidth' : `/api/nodes/${encodeURIComponent(nodeId)}/bandwidth`
  return call('PUT', path, limits)
}

/** The current/most recent upgrade sweep, or null before the first. Poll while `running`. */
export function getUpgradeRun(): Promise<{ run: UpgradeRun | null }> {
  return getJson('/api/upgrade')
}

/** Starts an upgrade sweep: every registered node, one at a time, health-checked. Returns immediately. */
export function startUpgradeAll(): Promise<void> {
  return call('POST', '/api/upgrade')
}

/** Restarts (or shuts down) one registered node's Syncthing. Shutdown does not come back on its own. */
export function restartNode(deviceId: string, action: 'restart' | 'shutdown'): Promise<void> {
  return call('POST', `/api/nodes/${encodeURIComponent(deviceId)}/${action}`)
}

/** Registers a new node with the proxy, persisted server-side (cluster.json). */
export function registerNode(id: string, url: string, apiKey: string): Promise<void> {
  return call('POST', '/api/nodes', { id, url, apiKey })
}

/** De-registers a node from the proxy. Doesn't touch its own Syncthing config or unlink it as a peer elsewhere. */
export function removeNode(nodeId: string): Promise<void> {
  return call('DELETE', `/api/nodes/${encodeURIComponent(nodeId)}`)
}

/** How every referencing registered node currently has this device configured (on-demand; not in the model). */
export function getDeviceOptions(deviceId: string): Promise<DeviceOptionsView> {
  return getJson(`/api/devices/${encodeURIComponent(deviceId)}/options`)
}

/** Applies the same device options on every registered node that references the device — same scope as pause/remove. */
export function setDeviceOptions(deviceId: string, options: DeviceOptions): Promise<void> {
  return call('PUT', `/api/devices/${encodeURIComponent(deviceId)}/options`, options)
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

/** On a `sendonly` folder: push this node's local version out, overriding remote changes. */
export function overrideFolder(deviceId: string, folderId: string): Promise<void> {
  return call(
    'POST',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/override`,
  )
}

/** On a `receiveonly` folder: discard this node's local-only changes. */
export function revertFolder(deviceId: string, folderId: string): Promise<void> {
  return call(
    'POST',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/revert`,
  )
}

export function setFolderType(deviceId: string, folderId: string, type: FolderType): Promise<void> {
  return call(
    'PATCH',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}`,
    { type },
  )
}

/** Renames this node's copy of the folder (labels are per-node; see drift detection). */
export function setFolderLabel(deviceId: string, folderId: string, label: string): Promise<void> {
  return call(
    'PATCH',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}`,
    { label },
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

/** Sets this folder's advanced options (rescan interval, watcher, min disk free) on one node. */
export function setFolderAdvanced(
  deviceId: string,
  folderId: string,
  opts: FolderAdvancedOptions,
): Promise<void> {
  return call(
    'PUT',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/options`,
    opts,
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

/** Every sharing node's `.stignore` patterns for one folder (on-demand; not in the model). */
export function getFolderIgnores(folderId: string): Promise<FolderIgnores> {
  return getJson(`/api/folders/${encodeURIComponent(folderId)}/ignores`)
}

/** Every sharing node's failed (pull-error) items for one folder — the detail behind `Share.failedItems`. */
export function getFolderFailedItems(folderId: string): Promise<FolderFailedItems> {
  return getJson(`/api/folders/${encodeURIComponent(folderId)}/failed-items`)
}

/** Scans every sharing node's folder tree for `*.sync-conflict-*` copies. Heavy on big folders — user-triggered only. */
export function getFolderConflicts(folderId: string): Promise<FolderConflicts> {
  return getJson(`/api/folders/${encodeURIComponent(folderId)}/conflicts`)
}

/** Replaces this folder's `.stignore` patterns on one node. */
export function setFolderIgnores(deviceId: string, folderId: string, patterns: string[]): Promise<void> {
  return call(
    'PUT',
    `/api/folders/${encodeURIComponent(folderId)}/devices/${encodeURIComponent(deviceId)}/ignores`,
    { patterns },
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
