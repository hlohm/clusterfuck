import { useMemo, useState } from 'react'
import './App.css'
import { GraphView } from './graph/GraphView'
import { Legend } from './graph/Legend'
import { DetailPanel } from './graph/DetailPanel'
import type { Selection } from './graph/selection'
import { FIXTURE_CLUSTERS } from './fixtures'
import { useLiveCluster } from './data/liveSource'

const LIVE_SOURCE_ID = '__live__'

function App() {
  const [sourceId, setSourceId] = useState(FIXTURE_CLUSTERS[0]!.id)
  const [selection, setSelection] = useState<Selection>(null)

  const isLive = sourceId === LIVE_SOURCE_ID
  const live = useLiveCluster(isLive)

  const fixtureCluster = useMemo(
    () => FIXTURE_CLUSTERS.find((c) => c.id === sourceId),
    [sourceId],
  )

  const cluster = isLive ? live.cluster : (fixtureCluster ?? FIXTURE_CLUSTERS[0]!)

  return (
    <div className="app">
      <header className="app__header">
        <h1>clusterfuck</h1>
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
        {isLive && live.status !== 'live' && (
          <span className="app__live-status" role="status">
            {live.status === 'connecting' ? 'Connecting to proxy…' : (live.error ?? 'Connection error')}
          </span>
        )}
      </header>

      <main className="app__main">
        {cluster ? (
          <>
            <div className="app__graph">
              <GraphView cluster={cluster} selection={selection} onSelect={setSelection} />
            </div>
            <div className="app__sidebar">
              <DetailPanel cluster={cluster} selection={selection} isLive={isLive} />
              <Legend />
            </div>
          </>
        ) : (
          <div className="app__empty">Waiting for live cluster data…</div>
        )}
      </main>
    </div>
  )
}

export default App
