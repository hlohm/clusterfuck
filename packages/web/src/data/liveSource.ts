import { useEffect, useState } from 'react'
import type { ClusterModel } from '@clusterfuck/shared'

export type LiveStatus = 'connecting' | 'live' | 'error'

export interface LiveCluster {
  cluster: ClusterModel | undefined
  status: LiveStatus
  error: string | undefined
}

const PROXY_BASE = import.meta.env.VITE_PROXY_URL ?? ''

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

    const source = new EventSource(`${PROXY_BASE}/api/events`)

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
