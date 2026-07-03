import { useMemo, useState } from 'react'
import './App.css'
import { GraphView } from './graph/GraphView'
import { Legend } from './graph/Legend'
import { DetailPanel } from './graph/DetailPanel'
import type { Selection } from './graph/selection'
import { FIXTURE_CLUSTERS } from './fixtures'

function App() {
  const [clusterId, setClusterId] = useState(FIXTURE_CLUSTERS[0]!.id)
  const [selection, setSelection] = useState<Selection>(null)

  const cluster = useMemo(
    () => FIXTURE_CLUSTERS.find((c) => c.id === clusterId) ?? FIXTURE_CLUSTERS[0]!,
    [clusterId],
  )

  return (
    <div className="app">
      <header className="app__header">
        <h1>clusterfuck</h1>
        <label className="app__fixture-picker">
          Fixture:
          <select
            value={clusterId}
            onChange={(event) => {
              setClusterId(event.target.value)
              setSelection(null)
            }}
          >
            {FIXTURE_CLUSTERS.map((c) => (
              <option key={c.id} value={c.id}>
                {c.label}
              </option>
            ))}
          </select>
        </label>
      </header>

      <main className="app__main">
        <div className="app__graph">
          <GraphView cluster={cluster} selection={selection} onSelect={setSelection} />
        </div>
        <div className="app__sidebar">
          <DetailPanel cluster={cluster} selection={selection} />
          <Legend />
        </div>
      </main>
    </div>
  )
}

export default App
