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

  private async get<T>(path: string, signal?: AbortSignal): Promise<T> {
    const res = await fetch(new URL(path, this.node.url), {
      headers: { 'X-API-Key': this.node.apiKey },
      signal,
    })
    if (!res.ok) {
      throw new Error(`${this.node.id}: GET ${path} -> HTTP ${res.status}`)
    }
    return (await res.json()) as T
  }

  private async send(
    method: 'POST' | 'PUT',
    path: string,
    body?: unknown,
    signal?: AbortSignal,
  ): Promise<void> {
    const res = await fetch(new URL(path, this.node.url), {
      method,
      headers: {
        'X-API-Key': this.node.apiKey,
        ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
      signal,
    })
    if (!res.ok) {
      throw new Error(`${this.node.id}: ${method} ${path} -> HTTP ${res.status}`)
    }
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
}
