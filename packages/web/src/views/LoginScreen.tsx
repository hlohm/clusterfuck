import { useState } from 'react'
import * as auth from '../data/auth'
import { Logo } from '../Logo'

/**
 * Full-screen gate shown while the proxy requires auth and this browser has
 * no valid session. One field: paste the shared access token (from whoever
 * runs the proxy, or the "Access token" reveal on an already-signed-in
 * browser); success sets the HttpOnly cookie and the app proceeds.
 */
export function LoginScreen({ onAuthorized }: { onAuthorized: () => void }) {
  const [token, setToken] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()

  const submit = () => {
    if (token === '' || busy) return
    setBusy(true)
    setError(undefined)
    auth
      .login(token)
      .then(onAuthorized)
      .catch((err: unknown) => {
        setError(err instanceof Error ? err.message : 'Login failed')
        setBusy(false)
      })
  }

  return (
    <div className="login">
      <form
        className="login__card"
        onSubmit={(event) => {
          event.preventDefault()
          submit()
        }}
      >
        <div className="login__brand">
          <Logo size={30} />
          <h1>clusterfuck</h1>
        </div>
        <p className="login__hint">
          This proxy requires an access token. Paste it once — this browser stays signed in via a
          cookie.
        </p>
        <input
          type="password"
          placeholder="Access token"
          autoFocus
          value={token}
          disabled={busy}
          onChange={(event) => setToken(event.target.value)}
        />
        <button className="detail-panel__button--primary" type="submit" disabled={busy || token === ''}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
        {error && <div className="detail-panel__error">{error}</div>}
      </form>
    </div>
  )
}
