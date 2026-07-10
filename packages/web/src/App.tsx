import { useEffect, useMemo, useState } from 'react'
import './App.css'
import type { Share } from '@clusterfuck/shared'
import { GraphView } from './graph/GraphView'
import { GraphErrorBoundary } from './graph/GraphErrorBoundary'
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
import { AddDeviceDialog, AddFolderDialog, RegisterNodeDialog } from './views/AddDialogs'
import { LoginScreen } from './views/LoginScreen'
import { getAuthStatus } from './data/auth'
import { setUnauthorizedListener } from './data/http'
import { loadPref, savePref } from './data/localPrefs'

const LIVE_SOURCE_ID = '__live__'

/** Wide enough for the share editors, never wider than half a typical screen. */
function clampSidebarWidth(width: number): number {
  return Math.min(640, Math.max(260, Math.round(width)))
}

type ViewId = 'graph' | 'overview' | 'table'

const VIEWS: { id: ViewId; label: string }[] = [
  { id: 'graph', label: 'Graph' },
  { id: 'overview', label: 'Overview' },
  { id: 'table', label: 'Table' },
]

function App() {
  // Auth gate: 'checking' until /api/auth answers; 'login' while the proxy
  // requires a token this browser doesn't have; 'ready' otherwise. An
  // unreachable proxy counts as ready — fixtures must stay browsable with no
  // proxy running, and the live view has its own connectivity errors.
  const [authState, setAuthState] = useState<'checking' | 'login' | 'ready'>('checking')
  useEffect(() => {
    getAuthStatus()
      .then((status) => setAuthState(status.required && !status.authorized ? 'login' : 'ready'))
      .catch(() => setAuthState('ready'))
    // Sessions don't last forever: the cookie expires (30d) and rotating the
    // token revokes it instantly. Any 401 from any request flips the app
    // back to the login gate instead of stranding it on inline errors.
    setUnauthorizedListener(() => setAuthState('login'))
    return () => setUnauthorizedListener(undefined)
  }, [])

  const [sourceId, setSourceId] = useState(FIXTURE_CLUSTERS[0]!.id)
  const [view, setView] = useState<ViewId>('graph')
  const [graphMode, setGraphMode] = useState<GraphMode>('nodes')
  const [selection, setSelection] = useState<Selection>(null)
  const [dialog, setDialog] = useState<'device' | 'folder' | 'node' | null>(null)

  const isLive = sourceId === LIVE_SOURCE_ID
  // Also gated on auth: while the login screen is up the stream would only
  // collect 401s, and closing it here is what makes it reconnect after login.
  const live = useLiveCluster(isLive && authState === 'ready')

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

  // Resizable detail sidebar (ROADMAP "UI design refinement"): drag the
  // divider or focus it and use arrow keys; the width sticks per browser.
  const [sidebarWidth, setSidebarWidth] = useState(() =>
    clampSidebarWidth(loadPref('sidebarWidth', 300)),
  )
  const setAndSaveSidebarWidth = (width: number) => {
    const clamped = clampSidebarWidth(width)
    setSidebarWidth(clamped)
    savePref('sidebarWidth', clamped)
  }
  const startSidebarResize = (event: React.PointerEvent) => {
    event.preventDefault()
    const startX = event.clientX
    const startWidth = sidebarWidth
    let latest = startWidth
    const onMove = (move: PointerEvent) => {
      // The sidebar sits right of the divider, so dragging left widens it.
      latest = clampSidebarWidth(startWidth + (startX - move.clientX))
      setSidebarWidth(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      savePref('sidebarWidth', latest)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const resizeSidebarByKey = (event: React.KeyboardEvent) => {
    if (event.key === 'ArrowLeft') setAndSaveSidebarWidth(sidebarWidth + 16)
    if (event.key === 'ArrowRight') setAndSaveSidebarWidth(sidebarWidth - 16)
  }

  if (authState === 'checking') {
    return <div className="app__empty">Checking access…</div>
  }
  if (authState === 'login') {
    return <LoginScreen onAuthorized={() => setAuthState('ready')} />
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
          {isLive && (
            <div className="app__add">
              <button onClick={() => setDialog('node')}>＋ Node</button>
              {cluster && <button onClick={() => setDialog('device')}>＋ Device</button>}
              {cluster && <button onClick={() => setDialog('folder')}>＋ Folder</button>}
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
              {/* Keyed on the source so switching data sources always gets a fresh boundary. */}
              <GraphErrorBoundary key={sourceId}>
                <GraphView
                  cluster={cluster}
                  selection={selection}
                  onSelect={setSelection}
                  mode={graphMode}
                  onModeChange={setGraphMode}
                />
              </GraphErrorBoundary>
            </div>
            <div
              className="app__resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize detail panel"
              tabIndex={0}
              onPointerDown={startSidebarResize}
              onKeyDown={resizeSidebarByKey}
            />
            <div className="app__sidebar" style={{ width: sidebarWidth }}>
              <DetailPanel
                cluster={cluster}
                selection={selection}
                onSelect={setSelection}
                isLive={isLive}
              />
              <Legend cluster={cluster} mode={graphMode} />
            </div>
          </>
        ) : view === 'overview' ? (
          <div className="app__scroll">
            <OverviewView cluster={cluster} onOpenShare={openShare} isLive={isLive} />
          </div>
        ) : (
          <div className="app__scroll">
            <TableView cluster={cluster} onOpenShare={openShare} />
          </div>
        )}
      </main>

      {dialog === 'node' && <RegisterNodeDialog onClose={() => setDialog(null)} />}
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
