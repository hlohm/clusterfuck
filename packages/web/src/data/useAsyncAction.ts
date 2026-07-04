import { useState } from 'react'

/** CLAUDE.md gates every Phase 3+ mutation behind a confirmation (or a preview dialog for creates). */
export function useAsyncAction() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  /** Returns false if the confirmation was declined (the action never ran). */
  const run = (confirmMessage: string | null, fn: () => Promise<void>): boolean => {
    if (confirmMessage !== null && !window.confirm(confirmMessage)) return false
    setBusy(true)
    setError(undefined)
    fn()
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Action failed')
      })
      .finally(() => setBusy(false))
    return true
  }

  return { busy, error, run }
}
