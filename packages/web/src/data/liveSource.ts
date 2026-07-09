import { useEffect, useState } from 'react'
import type { ClusterModel } from '@clusterfuck/shared'
import { PROXY_BASE } from './proxyBase'

export type LiveStatus = 'connecting' | 'live' | 'error'

export interface LiveCluster {
  cluster: ClusterModel | undefined
  status: LiveStatus
  error: string | undefined
}

/**
 * Subscribes to the proxy's /api/events SSE stream, which pushes a full
 * ClusterModel snapshot on every change. `enabled` gates the connection so
 * we don't hold it open while a fixture is selected instead.
 */
export function useLiveCluster(enabled: boolean): LiveCluster {
  const [cluster, setCluster] = useState<ClusterModel>()
  const [status, setStatus] = useState<LiveStatus>('connecting')
  const [error, setError] = useState<string>()

  useEffect(() => {
    if (!enabled) return

    setStatus('connecting')
    setError(undefined)

    // withCredentials sends the auth session cookie on a cross-origin proxy;
    // same-origin it changes nothing (EventSource always sends those).
    const source = new EventSource(`${PROXY_BASE}/api/events`, { withCredentials: true })

    source.onopen = () => setError(undefined)

    source.onmessage = (event) => {
      try {
        setCluster(JSON.parse(event.data) as ClusterModel)
        setStatus('live')
      } catch {
        // ignore malformed frames — next one will self-correct
      }
    }

    source.onerror = () => {
      setStatus('error')
      setError('Lost connection to the proxy — retrying…')
    }

    return () => source.close()
  }, [enabled])

  return { cluster, status, error }
}
