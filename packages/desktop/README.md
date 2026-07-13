# @clusterfuck/desktop — the Electron bundle

clusterfuck as a double-click desktop app: the same proxy every other
install runs, started inside Electron's main process, with the web UI in
its own window. Aimed primarily at the low-friction **Windows** case
(installer + portable exe); macOS and Linux fall out of the same build.

**Deliberately outside the pnpm workspace** (see `pnpm-workspace.yaml`):
its Electron devDependency is a ~100 MB download that normal dev/CI
installs must not pay for. It has its own `npm install`.

## How it fits together

- `build:proxy` bundles `packages/proxy` (+ the workspace `shared` package,
  via an esbuild alias) into one dependency-free **ESM** file,
  `dist/proxy.mjs`. ESM is load-bearing: the proxy resolves its version
  from `package.json` through `import.meta.url`, which a CJS bundle would
  break — and inside the packaged app that path lands on this package's
  own (version-lockstepped) `package.json`.
- `main.cjs` sets the state paths to Electron's per-user data dir
  (`cluster.json` / `auth.json` — same files and formats as every other
  install), imports the bundle, waits for `/api/health`, and opens a
  sandboxed window on `http://127.0.0.1:41945`. Closing the window quits
  the app and the proxy with it.

## Build

```sh
cd packages/desktop
npm install            # downloads Electron — commit the package-lock this produces
npm start              # build + run locally
npm run dist           # installers into release/ (NSIS + portable on Windows,
                       # dmg on macOS, AppImage on Linux — build on the target OS)
```

CI builds for all three OSes run on tagged releases (`v*`) via
`.github/workflows/desktop-build.yml` and attach the installers to the
GitHub release.

## Known caveats

- **Unsigned binaries**: Windows SmartScreen and macOS Gatekeeper will
  warn. Code-signing is deliberately out of scope pre-1.0.
- The proxy binds `127.0.0.1:41945` inside the app; enable auth anyway if
  other users share the machine (Settings ⚙, same as everywhere).
- Electron has not been executed in the authoring environment (headless
  sandbox): the proxy bundle is boot-verified with plain Node; the first
  `npm start` on a real desktop is the first full run.
