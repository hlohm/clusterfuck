# @clusterfuck/proxy

The thin backend between the frontend and one or more Syncthing nodes. Holds
API keys, aggregates each node's own view into one normalized `ClusterModel`
(`@clusterfuck/shared`), and serves it read-only over HTTP + Server-Sent
Events. See the root `README.md` (Phase 2 section) for the decisions behind
this design.

## Setup

```sh
cp dev-cluster.example.json dev-cluster.json
# edit dev-cluster.json with your nodes' URLs and API keys
```

`dev-cluster.json` is gitignored — never commit real endpoints or keys.

## Run

```sh
npm run dev --workspace=@clusterfuck/proxy   # from the repo root
# or, from this directory:
npm run dev
```

Listens on `PORT` (default `4000`). Routes:

- `GET /api/cluster` — current `ClusterModel` snapshot.
- `GET /api/events` — Server-Sent Events stream; pushes a full snapshot on
  every change.
- `GET /api/health` — liveness check.

`CLUSTERFUCK_WEB_ORIGIN` (default `http://localhost:5173`) sets the CORS
origin allowed to read these routes — only needed if the frontend talks to
the proxy directly instead of through Vite's dev proxy (`packages/web`
forwards `/api/*` to `http://localhost:4000` in dev, so in normal local dev
you won't hit CORS at all).

`CLUSTERFUCK_CONFIG` overrides the node-config file path (default
`./dev-cluster.json`, resolved relative to the process's cwd).

## Notes

- Runs `.ts` source directly via Node's native type stripping — no build
  step, no bundler/ts-node. `npm run typecheck` still gates correctness.
- Targets the Syncthing 1.x REST shape (see `src/syncthing/types.ts`).
