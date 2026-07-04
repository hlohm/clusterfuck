import { useEffect, useMemo, useState } from 'react'
import './App.css'
import type { Share } from '@clusterfuck/shared'
import { GraphView } from './graph/GraphView'
import { Legend } from './graph/Legend'
import { DetailPanel } from './graph/DetailPanel'
import type { Selection } from './graph/selection'
import type { GraphMode } from './graph/adapter/GraphAdapter'
import { FIXTURE_CLUSTERS } from './fixtures'
import { useLiveCluster } from './data/liveSource'
import { PROXY_BASE } from './data/proxyBase'
import { Logo } from './Logo'
import { OverviewView } from './views/OverviewView'
import { TableView } from './views/TableView'
import { AddDeviceDialog, AddFolderDialog } from './views/AddDialogs'

const LIVE_SOURCE_ID = '__live__'

type ViewId = 'graph' | 'overview' | 'table'

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'overview', label: 'Overview' },
  { id: 'table', label: 'Table' },
]

function App() {
  const [sourceId, setSourceId] = useState(FIXTURE_CLUSTERS[0]!.id)
  const [view, setView] = useState<ViewId>('graph')
  const [graphMode, setGraphMode] = useState<GraphMode>('nodes')
  const [selection, setSelection] = useState<Selection>(null)
  const [dialog, setDialog] = useState<'device' | 'folder' | null>(null)

  const isLive = sourceId === LIVE_SOURCE_ID
  const live = useLiveCluster(isLive)

  // A stale proxy process serving routes an updated frontend expects fails
  // with an opaque 404 — surfacing both versions makes that mismatch obvious
  // instead of a support mystery.
  const [proxyVersion, setProxyVersion] = useState<string>()
  useEffect(() => {
    if (!isLive) {
      setProxyVersion(undefined)
      return
    }
    let cancelled = false
    fetch(`${PROXY_BASE}/api/version`)
      .then((res) => (res.ok ? (res.json() as Promise<{ version?: string }>) : undefined))
      .then((data) => {
        if (!cancelled && data?.version) setProxyVersion(data.version)
      })
      .catch(() => {
        // Best-effort — /api/cluster and /api/events already surface real connectivity errors.
      })
    return () => {
      cancelled = true
    }
  }, [isLive])

  const fixtureCluster = useMemo(
    () => FIXTURE_CLUSTERS.find((c) => c.id === sourceId),
    [sourceId],
  )

  const cluster = isLive ? live.cluster : (fixtureCluster ?? FIXTURE_CLUSTERS[0]!)

  /** From overview/table, jump to the graph with that share selected. */
  const openShare = (share: Share) => {
    setSelection({ kind: 'share', folderId: share.folderId, deviceId: share.deviceId })
    setView('graph')
  }

  return (
    <div className="app">
      <header className="app__header">
        <div className="app__brand">
          <Logo size={30} />
          <h1>clusterfuck</h1>
          <span className="app__version" title={`web build v${__APP_VERSION__}`}>
            v{__APP_VERSION__}
          </span>
          {proxyVersion && proxyVersion !== __APP_VERSION__ && (
            <span
              className="app__version app__version--mismatch"
              title={`Proxy is running v${proxyVersion}, this web build is v${__APP_VERSION__}. A stale proxy process can 404 on routes this build expects — restart it.`}
            >
              ⚠ proxy v{proxyVersion}
            </span>
          )}
        </div>

        <nav className="app__tabs" aria-label="View">
          {VIEWS.map((v) => (
            <button
              key={v.id}
              className="app__tab"
              data-active={view === v.id}
              onClick={() => setView(v.id)}
            >
              {v.label}
            </button>
          ))}
        </nav>

        <div className="app__controls">
          {isLive && live.status !== 'live' && (
            <span className="app__live-status" role="status">
              {live.status === 'connecting' ? 'Connecting to proxy…' : (live.error ?? 'Connection error')}
            </span>
          )}
          {isLive && cluster && (
            <div className="app__add">
              <button onClick={() => setDialog('device')}>＋ Device</button>
              <button onClick={() => setDialog('folder')}>＋ Folder</button>
            </div>
          )}
          <label className="app__fixture-picker">
            Source:
            <select
              value={sourceId}
              onChange={(event) => {
                setSourceId(event.target.value)
                setSelection(null)
              }}
            >
              <option value={LIVE_SOURCE_ID}>Live cluster (proxy)</option>
              {FIXTURE_CLUSTERS.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </header>

      <main className="app__main">
        {!cluster ? (
          <div className="app__empty">Waiting for live cluster data…</div>
        ) : view === 'graph' ? (
          <>
            <div className="app__graph">
              <GraphView
                cluster={cluster}
                selection={selection}
                onSelect={setSelection}
                mode={graphMode}
                onModeChange={setGraphMode}
              />
            </div>
            <div className="app__sidebar">
              <DetailPanel cluster={cluster} selection={selection} isLive={isLive} />
              <Legend cluster={cluster} mode={graphMode} />
            </div>
          </>
        ) : view === 'overview' ? (
          <div className="app__scroll">
            <OverviewView cluster={cluster} onOpenShare={openShare} />
          </div>
        ) : (
          <div className="app__scroll">
            <TableView cluster={cluster} onOpenShare={openShare} />
          </div>
        )}
      </main>

      {cluster && dialog === 'device' && (
        <AddDeviceDialog cluster={cluster} onClose={() => setDialog(null)} />
      )}
      {cluster && dialog === 'folder' && (
        <AddFolderDialog cluster={cluster} onClose={() => setDialog(null)} />
      )}
    </div>
  )
}

export default App
