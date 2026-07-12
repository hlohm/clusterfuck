// Electron main process: start the bundled proxy in-process, then open a
// window on it. The proxy is exactly the one every other install runs —
// bundled to a single dependency-free file by esbuild (see build:proxy), so
// nothing here depends on Electron's embedded Node supporting native
// TypeScript type-stripping.
const { app, BrowserWindow, shell } = require('electron')
const { join } = require('node:path')

// A fixed, uncommon port: stable enough to bookmark, unlikely to collide
// with a manually-run proxy on 4000. Overridable like any install.
const PORT = process.env.PORT ?? '41945'

function startProxy() {
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
  void import('./dist/proxy.mjs')
}

async function waitForProxy(url, tries = 50) {
  for (let i = 0; i < tries; i++) {
    try {
      if ((await fetch(`${url}/api/health`)).ok) return
    } catch {
      // not up yet
    }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`proxy did not answer on ${url} within ${tries * 100}ms`)
}

async function createWindow() {
  const url = `http://127.0.0.1:${PORT}`
  await waitForProxy(url)
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
  await win.loadURL(url)
}

app.whenReady().then(() => {
  startProxy()
  void createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) void createWindow()
  })
})

app.on('window-all-closed', () => {
  // The proxy dies with the app on every platform — a hidden always-on
  // server would contradict "the window is the app". macOS dock-lingering
  // is deliberately not used.
  app.quit()
})
