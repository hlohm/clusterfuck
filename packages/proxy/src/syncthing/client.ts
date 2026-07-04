import type {
  ConfigFolder,
  ConfigResponse,
  ConnectionsResponse,
  DbStatusResponse,
  FolderErrorsResponse,
  SyncthingEvent,
  SystemStatusResponse,
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

  private async request(
    method: 'GET' | 'POST' | 'PUT',
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
    method: 'POST' | 'PUT',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    await this.request(method, path, body, signal)
  }

  systemStatus(signal?: AbortSignal): Promise<SystemStatusResponse> {
    return this.get('/rest/system/status', signal)
  }

  config(signal?: AbortSignal): Promise<ConfigResponse> {
    return this.get('/rest/config', signal)
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
   * Long-polls /rest/events. Resolves with the next batch once new events
   * arrive or the ~60s server-side poll timeout elapses (empty array).
   * Pass the last-seen event id as `since`; 0 on first call.
   */
  events(since: number, signal?: AbortSignal): Promise<SyncthingEvent[]> {
    return this.get(`/rest/events?since=${since}`, signal)
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

  /** Adds (or replaces) a folder in this node's config. */
  postFolder(folder: ConfigFolder, signal?: AbortSignal): Promise<void> {
    return this.send('POST', '/rest/config/folders', folder, signal)
  }
}
