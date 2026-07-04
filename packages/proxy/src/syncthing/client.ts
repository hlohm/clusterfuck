import type {
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
}
