import { useState } from 'react'
import type { ClusterModel, Device } from '@clusterfuck/shared'

/** Split out from AddDialogs.tsx: mixing hooks and components in one file breaks Fast Refresh. */
export function useNodePicker(cluster: ClusterModel) {
  const managed = cluster.devices.filter((d) => d.managed)
  const [selected, setSelected] = useState<Set<string>>(new Set(managed.map((d) => d.id)))

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const picker = (
    <fieldset className="dialog__nodes">
      <legend>On nodes</legend>
      {managed.map((d: Device) => (
        <label key={d.id}>
          <input type="checkbox" checked={selected.has(d.id)} onChange={() => toggle(d.id)} />
          {d.name}
        </label>
      ))}
    </fieldset>
  )

  return { managed, selected: [...selected], picker }
}

export function useSubmit(onDone: () => void) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = (fn: () => Promise<void>) => {
    setBusy(true)
    setError(undefined)
    fn()
      .then(onDone)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Request failed')
        setBusy(false)
      })
  }

  return { busy, error, submit }
}
