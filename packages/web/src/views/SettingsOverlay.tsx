import { useEffect, useState } from 'react'
import * as auth from '../data/auth'
import { CopyButton } from './CopyButton'

/**
 * The one place all auth management lives (ROADMAP "UI design refinement"):
 * initialise auth on an open proxy, rotate the token, auto-generate one,
 * reveal the current token to sign in elsewhere, and sign out. Opened from
 * the header. There is deliberately no "disable auth" — that requires
 * removing the token file and restarting (see the env-managed note).
 */
export function SettingsOverlay({ onClose }: { onClose: () => void }) {
  const [status, setStatus] = useState<auth.AuthStatus>()
  const [loadError, setLoadError] = useState<string>()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const [revealed, setRevealed] = useState<string>()
  /** A token to display prominently after enabling/rotating — "save this now". */
  const [freshToken, setFreshToken] = useState<string>()
  const [customToken, setCustomToken] = useState('')
  const [entering, setEntering] = useState(false)

  const refresh = () =>
    auth
      .getAuthStatus()
      .then(setStatus)
      .catch((err: unknown) => setLoadError(err instanceof Error ? err.message : 'Failed to load'))

  useEffect(() => {
    void refresh()
  }, [])

  const applyToken = (token?: string) => {
    setBusy(true)
    setError(undefined)
    auth
      .setAuthToken(token)
      .then((next) => {
        setFreshToken(next)
        setRevealed(undefined)
        setCustomToken('')
        setEntering(false)
        return refresh()
      })
      .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
      .finally(() => setBusy(false))
  }

  const rotate = (token?: string) => {
    if (
      status?.required &&
      !window.confirm(
        'Rotate the access token? Every other signed-in browser is immediately signed out and ' +
          'must enter the new token.',
      )
    ) {
      return
    }
    applyToken(token)
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog" onClick={(event) => event.stopPropagation()}>
        <h3>Authentication</h3>

        {loadError && <div className="dialog__error">{loadError}</div>}
        {status && (
          <>
            <p className="dialog__preview">
              {!status.required
                ? 'This proxy is currently open — anyone who can reach it has full access.'
                : status.managedByEnv
                  ? 'Enabled, managed by the CLUSTERFUCK_TOKEN environment variable.'
                  : 'Enabled — a token is required to access this proxy.'}
            </p>

            {freshToken && (
              <div className="settings-token">
                <div className="dialog__field">
                  Save this token — enter it on other browsers/devices to sign in:
                  <div className="settings-token__value">
                    <code className="access-token">{freshToken}</code>
                    <CopyButton text={freshToken} />
                  </div>
                </div>
              </div>
            )}

            {/* Open proxy: offer to turn auth on. */}
            {!status.required && !freshToken && (
              <div className="dialog__field">
                {entering ? (
                  <>
                    <label>
                      Token (min 16 characters):
                      <input
                        type="text"
                        value={customToken}
                        disabled={busy}
                        onChange={(event) => setCustomToken(event.target.value)}
                      />
                    </label>
                    <div className="dialog__actions">
                      <button onClick={() => setEntering(false)} disabled={busy}>
                        Cancel
                      </button>
                      <button
                        className="dialog__primary"
                        disabled={busy || customToken.length < 16}
                        onClick={() => applyToken(customToken)}
                      >
                        Enable
                      </button>
                    </div>
                  </>
                ) : (
                  <div className="dialog__actions">
                    <button onClick={() => setEntering(true)} disabled={busy}>
                      Enter a token…
                    </button>
                    <button className="dialog__primary" disabled={busy} onClick={() => applyToken()}>
                      Generate & enable
                    </button>
                  </div>
                )}
              </div>
            )}

            {/* Enabled, file-managed: reveal / rotate / generate / sign out. */}
            {status.required && !status.managedByEnv && (
              <>
                <div className="dialog__field">
                  Current token:
                  <div className="settings-token__value">
                    {revealed !== undefined ? (
                      <>
                        <code className="access-token">{revealed}</code>
                        <CopyButton text={revealed} />
                        <button
                          className="detail-panel__link-button"
                          onClick={() => setRevealed(undefined)}
                        >
                          Hide
                        </button>
                      </>
                    ) : (
                      <button
                        disabled={busy}
                        onClick={() =>
                          auth
                            .getToken()
                            .then(setRevealed)
                            .catch((err: unknown) =>
                              setError(err instanceof Error ? err.message : 'Failed'),
                            )
                        }
                      >
                        Show token
                      </button>
                    )}
                  </div>
                </div>
                {entering ? (
                  <div className="dialog__field">
                    <label>
                      New token (min 16 characters):
                      <input
                        type="text"
                        value={customToken}
                        disabled={busy}
                        onChange={(event) => setCustomToken(event.target.value)}
                      />
                    </label>
                    <div className="dialog__actions">
                      <button onClick={() => setEntering(false)} disabled={busy}>
                        Cancel
                      </button>
                      <button
                        className="dialog__primary"
                        disabled={busy || customToken.length < 16}
                        onClick={() => rotate(customToken)}
                      >
                        Set token
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="dialog__actions">
                    <button disabled={busy} onClick={() => setEntering(true)}>
                      Enter new token…
                    </button>
                    <button disabled={busy} onClick={() => rotate()}>
                      Generate new token
                    </button>
                  </div>
                )}
              </>
            )}

            {/* Env-managed: read-only, with the how-to-change note. */}
            {status.required && status.managedByEnv && (
              <div className="dialog__field">
                Current token:
                <div className="settings-token__value">
                  {revealed !== undefined ? (
                    <>
                      <code className="access-token">{revealed}</code>
                      <CopyButton text={revealed} />
                      <button
                        className="detail-panel__link-button"
                        onClick={() => setRevealed(undefined)}
                      >
                        Hide
                      </button>
                    </>
                  ) : (
                    <button
                      disabled={busy}
                      onClick={() =>
                        auth
                          .getToken()
                          .then(setRevealed)
                          .catch((err: unknown) => setError(err instanceof Error ? err.message : 'Failed'))
                      }
                    >
                      Show token
                    </button>
                  )}
                </div>
                <p className="dialog__preview">
                  Change it in the CLUSTERFUCK_TOKEN environment variable and restart the proxy. To
                  disable authentication entirely, remove the proxy's auth file and restart.
                </p>
              </div>
            )}

            {status.required && (
              <div className="dialog__actions">
                <button
                  className="detail-panel__link-button"
                  onClick={() => {
                    void auth
                      .logout()
                      .catch(() => undefined)
                      .finally(() => window.location.reload())
                  }}
                >
                  Sign out
                </button>
              </div>
            )}
          </>
        )}

        {error && <div className="dialog__error">{error}</div>}
        <div className="dialog__actions">
          <button onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
