import { useMemo, useState } from 'react'
import './App.css'
import type { Share } from '@clusterfuck/shared'
import { GraphView } from './graph/GraphView'
import { Legend } from './graph/Legend'
import { DetailPanel } from './graph/DetailPanel'
import type { Selection } from './graph/selection'
import { FIXTURE_CLUSTERS } from './fixtures'
import { useLiveCluster } from './data/liveSource'
import { Logo } from './Logo'
import { OverviewView } from './views/OverviewView'
import { TableView } from './views/TableView'

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
  const [selection, setSelection] = useState<Selection>(null)

  const isLive = sourceId === LIVE_SOURCE_ID
  const live = useLiveCluster(isLive)

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
              <GraphView cluster={cluster} selection={selection} onSelect={setSelection} />
            </div>
            <div className="app__sidebar">
              <DetailPanel cluster={cluster} selection={selection} isLive={isLive} />
              <Legend />
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
    </div>
  )
}

export default App
