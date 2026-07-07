import type {
  ConfigDevice,
  ConfigFolder,
  ConfigOptions,
  ConfigResponse,
  ConnectionsResponse,
  DbBrowseItem,
  DbIgnoresResponse,
  DbStatusResponse,
  FolderErrorsResponse,
  PendingDevicesResponse,
  PendingFoldersResponse,
  SyncthingEvent,
  SystemStatusResponse,
  SystemVersionResponse,
  UpgradeCheckResponse,
} from './types.ts'

export interface NodeConfig {
  id: string
  url: string
  apiKey: string
}

/** Thin wrapper around one Syncthing node's REST API. Holds the API key. */
export class SyncthingClient {
  private readonly node: NodeConfig

  constructor(node: NodeConfig) {
    this.node = node
  }

  get id(): string {
    return this.node.id
  }

  /**
   * Full config this client holds, including the API key — only for
   * persisting the node registry back to disk (ClusterStateManager.persist).
   * Never expose this over HTTP; nothing else should call it.
   */
  toConfig(): NodeConfig {
    return { ...this.node }
  }

  private async request(
    method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<Response> {
    let res: Response
    try {
      res = await fetch(new URL(path, this.node.url), {
        method,
        headers: {
          'X-API-Key': this.node.apiKey,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal,
      })
    } catch {
      // A connection-level failure (ECONNREFUSED, DNS, TLS, ...) throws
      // whatever fetch/undici attaches, which can include this node's raw
      // internal URL in .cause — normalize instead of letting that bubble
      // into an HTTP error response.
      throw new Error(`${this.node.id}: ${method} ${path} -> connection failed`)
    }
    if (!res.ok) {
      throw new Error(`${this.node.id}: ${method} ${path} -> HTTP ${res.status}`)
    }
    return res
  }

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await this.request('GET', path, undefined, signal)
    return (await res.json()) as T
  }

  private async send(
    method: 'POST' | 'PUT' | 'PATCH' | 'DELETE',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(method, path, body, signal)
  }

  systemStatus(signal?: AbortSignal): Promise<SystemStatusResponse> {
    return this.get('/rest/system/status', signal)
  }

  systemVersion(signal?: AbortSignal): Promise<SystemVersionResponse> {
    return this.get('/rest/system/version', signal)
  }

  config(signal?: AbortSignal): Promise<ConfigResponse> {
    return this.get('/rest/config', signal)
  }

  /** This node's global options (we only read the bandwidth-limit subset). */
  options(signal?: AbortSignal): Promise<ConfigOptions> {
    return this.get('/rest/config/options', signal)
  }

  /** Merges the given fields into this node's global options — element-scoped PATCH, everything else untouched. */
  patchOptions(fields: ConfigOptions, signal?: AbortSignal): Promise<void> {
    return this.send('PATCH', '/rest/config/options', fields, signal)
  }

  connections(signal?: AbortSignal): Promise<ConnectionsResponse> {
    return this.get('/rest/system/connections', signal)
  }

  dbStatus(folderId: string, signal?: AbortSignal): Promise<DbStatusResponse> {
    return this.get(`/rest/db/status?folder=${encodeURIComponent(folderId)}`, signal)
  }

  folderErrors(folderId: string, signal?: AbortSignal): Promise<FolderErrorsResponse> {
    return this.get(`/rest/folder/errors?folder=${encodeURIComponent(folderId)}`, signal)
  }

  /**
   * This node's full view of the folder tree, nested via `children`. Heavy on
   * big folders — only ever called on demand (conflict scan), never as part
   * of the snapshot/refresh cycle.
   */
  dbBrowse(folderId: string, signal?: AbortSignal): Promise<DbBrowseItem[]> {
    return this.get(`/rest/db/browse?folder=${encodeURIComponent(folderId)}`, signal)
  }

  /**
   * Long-polls /rest/events. Resolves with the next batch once new events
   * arrive or the ~60s server-side poll timeout elapses (empty array).
   * Pass the last-seen event id as `since`; 0 on first call.
   */
  events(since: number, signal?: AbortSignal): Promise<SyncthingEvent[]> {
    return this.get(`/rest/events?since=${since}`, signal)
  }

  /**
   * Long-polls the disk-events stream (LocalChangeDetected /
   * RemoteChangeDetected) — these are not delivered on the default events
   * endpoint, hence the separate loop. Same since/timeout semantics as
   * events().
   */
  diskEvents(since: number, signal?: AbortSignal): Promise<SyncthingEvent[]> {
    return this.get(`/rest/events/disk?since=${since}`, signal)
  }

  /** Pauses *this node's* connection to the given device. */
  pauseDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
    return this.send('POST', `/rest/system/pause?device=${encodeURIComponent(deviceId)}`, undefined, signal)
  }

  /** Resumes *this node's* connection to the given device. */
  resumeDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
    return this.send('POST', `/rest/system/resume?device=${encodeURIComponent(deviceId)}`, undefined, signal)
  }

  rescanFolder(folderId: string, signal?: AbortSignal): Promise<void> {
    return this.send('POST', `/rest/db/scan?folder=${encodeURIComponent(folderId)}`, undefined, signal)
  }

  /** Whether a newer Syncthing release exists for this node. */
  upgradeCheck(signal?: AbortSignal): Promise<UpgradeCheckResponse> {
    return this.get('/rest/system/upgrade', signal)
  }

  /** Downloads and installs the newest release, then restarts. Only works for upgrade-capable builds (not distro packages). */
  upgradePerform(signal?: AbortSignal): Promise<void> {
    return this.send('POST', '/rest/system/upgrade', undefined, signal)
  }

  /** Restarts this node's Syncthing process (it comes back on its own). */
  restart(signal?: AbortSignal): Promise<void> {
    return this.send('POST', '/rest/system/restart', undefined, signal)
  }

  /** Shuts this node's Syncthing down — it does NOT come back until started out-of-band. */
  shutdown(signal?: AbortSignal): Promise<void> {
    return this.send('POST', '/rest/system/shutdown', undefined, signal)
  }

  /** On a `sendonly` folder: push this node's local version out, overriding remote changes. */
  overrideFolder(folderId: string, signal?: AbortSignal): Promise<void> {
    return this.send('POST', `/rest/db/override?folder=${encodeURIComponent(folderId)}`, undefined, signal)
  }

  /** On a `receiveonly` folder: discard this node's local-only changes, reverting to the cluster's version. */
  revertFolder(folderId: string, signal?: AbortSignal): Promise<void> {
    return this.send('POST', `/rest/db/revert?folder=${encodeURIComponent(folderId)}`, undefined, signal)
  }

  /** This folder's `.stignore` patterns on this node (raw lines + expanded form). */
  folderIgnores(folderId: string, signal?: AbortSignal): Promise<DbIgnoresResponse> {
    return this.get(`/rest/db/ignores?folder=${encodeURIComponent(folderId)}`, signal)
  }

  /** Replaces this folder's `.stignore` patterns on this node. */
  setFolderIgnores(folderId: string, patterns: string[], signal?: AbortSignal): Promise<void> {
    return this.send('POST', `/rest/db/ignores?folder=${encodeURIComponent(folderId)}`, { ignore: patterns }, signal)
  }

  /**
   * PNG QR code for arbitrary text, rendered by this node's own GUI server —
   * the same `/qr/` endpoint Syncthing's web UI uses for device IDs. Not
   * under /rest, but authenticated with the same API key.
   */
  async qrPng(text: string, signal?: AbortSignal): Promise<Buffer> {
    const res = await this.request('GET', `/qr/?text=${encodeURIComponent(text)}`, undefined, signal)
    return Buffer.from(await res.arrayBuffer())
  }

  folderConfig(folderId: string, signal?: AbortSignal): Promise<ConfigFolder> {
    return this.get(`/rest/config/folders/${encodeURIComponent(folderId)}`, signal)
  }

  putFolderConfig(folderId: string, folder: ConfigFolder, signal?: AbortSignal): Promise<void> {
    return this.send('PUT', `/rest/config/folders/${encodeURIComponent(folderId)}`, folder, signal)
  }

  /** Adds (or replaces) a device entry in this node's config. */
  postDevice(device: { deviceID: string; name?: string }, signal?: AbortSignal): Promise<void> {
    return this.send('POST', '/rest/config/devices', device, signal)
  }

  /** This node's config entry for one device (how *it* has the peer configured). */
  deviceConfig(deviceId: string, signal?: AbortSignal): Promise<ConfigDevice> {
    return this.get(`/rest/config/devices/${encodeURIComponent(deviceId)}`, signal)
  }

  /**
   * Merges the given fields into this node's config entry for the device —
   * Syncthing's element-scoped PATCH, so unmentioned fields are untouched
   * without a read-modify-write round-trip.
   */
  patchDeviceConfig(deviceId: string, fields: Partial<ConfigDevice>, signal?: AbortSignal): Promise<void> {
    return this.send('PATCH', `/rest/config/devices/${encodeURIComponent(deviceId)}`, fields, signal)
  }

  /** Adds (or replaces) a folder in this node's config. */
  postFolder(folder: ConfigFolder, signal?: AbortSignal): Promise<void> {
    return this.send('POST', '/rest/config/folders', folder, signal)
  }

  /** Removes a device from this node's config (and from every folder it shared on this node). */
  deleteDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
    return this.send('DELETE', `/rest/config/devices/${encodeURIComponent(deviceId)}`, undefined, signal)
  }

  /** Removes a folder from this node's config (does not touch the data on disk). */
  deleteFolder(folderId: string, signal?: AbortSignal): Promise<void> {
    return this.send('DELETE', `/rest/config/folders/${encodeURIComponent(folderId)}`, undefined, signal)
  }

  /** Remote devices that have tried to connect but aren't configured yet. */
  pendingDevices(signal?: AbortSignal): Promise<PendingDevicesResponse> {
    return this.get('/rest/cluster/pending/devices', signal)
  }

  /** Folders already-known peers have offered but this node hasn't joined. */
  pendingFolders(signal?: AbortSignal): Promise<PendingFoldersResponse> {
    return this.get('/rest/cluster/pending/folders', signal)
  }

  /** Dismisses a pending-device notification on this node (doesn't ignore it permanently). */
  dismissPendingDevice(deviceId: string, signal?: AbortSignal): Promise<void> {
    return this.send(
      'DELETE',
      `/rest/cluster/pending/devices?device=${encodeURIComponent(deviceId)}`,
      undefined,
      signal,
    )
  }

  /** Dismisses a pending-folder notification on this node; `offeredBy` narrows to one offering device. */
  dismissPendingFolder(folderId: string, offeredBy?: string, signal?: AbortSignal): Promise<void> {
    const params = new URLSearchParams({ folder: folderId })
    if (offeredBy) params.set('device', offeredBy)
    return this.send('DELETE', `/rest/cluster/pending/folders?${params}`, undefined, signal)
  }
}
