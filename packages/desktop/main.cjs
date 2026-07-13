// Electron main process: start the bundled proxy in-process, then open a
// window on it. The proxy is exactly the one every other install runs —
// bundled to a single dependency-free file by esbuild (see build:proxy), so
// nothing here depends on Electron's embedded Node supporting native
// TypeScript type-stripping.
const { app, BrowserWindow, dialog, shell } = require('electron')
const { join } = require('node:path')

// A fixed, uncommon port: stable enough to bookmark, unlikely to collide
// with a manually-run proxy on 4000. Overridable like any install.
const PORT = process.env.PORT ?? '41945'

const POLL_INTERVAL_MS = 100

function errorText(err) {
  return err instanceof Error ? err.message : String(err)
}

async function startProxy() {
  // State lives in the OS-conventional per-user app dir (e.g.
  // %APPDATA%/clusterfuck on Windows) — same files, same formats, same
  // env overrides as every other install.
  const stateDir = app.getPath('userData')
  process.env.PORT = PORT
  process.env.CLUSTERFUCK_CONFIG ??= join(stateDir, 'cluster.json')
  process.env.CLUSTERFUCK_AUTH_CONFIG ??= join(stateDir, 'auth.json')
  process.env.CLUSTERFUCK_WEB_DIST ??= join(__dirname, 'dist', 'web')
  // ESM bundle (import.meta.url must stay real — version.ts resolves the
  // app's package.json through it), loaded from CJS via dynamic import.
  // Awaiting the import surfaces module-evaluation errors (a malformed
  // cluster.json throws there) with their real message; awaiting `ready`
  // surfaces bind failures (EADDRINUSE), which fire only after evaluation.
  const proxy = await import('./dist/proxy.mjs')
  await proxy.ready
}

async function waitForProxy(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS))
  }
  throw new Error(
    `The proxy did not answer on ${url} within ${(tries * POLL_INTERVAL_MS) / 1000}s. ` +
      `Is something else already using port ${PORT}? (Override with the PORT env var.)`,
  )
}

async function createWindow() {
  const win = new BrowserWindow({
    width: 1280,
    height: 840,
    // The renderer is just our web app talking HTTP to the local proxy —
    // it gets no Node/Electron capabilities at all.
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  })
  // External links (Syncthing docs etc.) go to the real browser.
  win.webContents.setWindowOpenHandler(({ url: external }) => {
    void shell.openExternal(external)
    return { action: 'deny' }
  })
  await win.loadURL(`http://127.0.0.1:${PORT}`)
}

// The one createWindow entry point for every call site, so a failed open is
// never a silently dropped rejection — the bug class this file's error
// handling exists to prevent.
function openWindow() {
  createWindow().catch((err) => {
    // Closing the window mid-load aborts loadURL — that's the quit path
    // (window-all-closed fires), not an error worth a dialog.
    if (err?.code === 'ERR_ABORTED') return
    dialog.showErrorBox('clusterfuck window failed to open', errorText(err))
    app.quit()
  })
}

async function start() {
  // A failed start must never leave the app running invisibly — no window,
  // no error is indistinguishable from "the app is broken". Show what went
  // wrong and quit. Window/page failures after the proxy is up are handled
  // separately in openWindow, so they can't masquerade as startup errors.
  try {
    await startProxy()
    await waitForProxy(`http://127.0.0.1:${PORT}`)
  } catch (err) {
    dialog.showErrorBox('clusterfuck could not start', errorText(err))
    app.quit()
    return
  }
  openWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) openWindow()
  })
}

// Two copies of the app would fight over one port and one state dir — the
// second launch hands over to the first instance's window instead. (Without
// this, the second instance's proxy loses the port bind but its health poll
// would happily answer from the *first* instance's proxy, wiring one backend
// to two windows.)
if (app.requestSingleInstanceLock()) {
  app.on('second-instance', () => {
    const [win] = BrowserWindow.getAllWindows()
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }
  })
  app.whenReady().then(start)
} else {
  app.quit()
}

app.on('window-all-closed', () => {
  // The proxy dies with the app on every platform — a hidden always-on
  // server would contradict "the window is the app". macOS dock-lingering
  // is deliberately not used.
  app.quit()
})
