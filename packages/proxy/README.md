# @clusterfuck/proxy

The thin backend between the frontend and one or more Syncthing nodes. Holds
API keys, aggregates each node's own view into one normalized `ClusterModel`
(`@clusterfuck/shared`), and serves it read-only over HTTP + Server-Sent
Events. See [`ROADMAP.md`](../../ROADMAP.md) (Phase 2) for the decisions behind
this design.

## Setup

```sh
cp dev-cluster.example.json dev-cluster.json
# edit dev-cluster.json with your nodes' URLs and API keys
```

`dev-cluster.json` is gitignored — never commit real endpoints or keys.

## Run

```sh
pnpm --filter @clusterfuck/proxy dev   # from the repo root
# or, from this directory:
pnpm dev
```

Listens on `PORT` (default `4000`). Routes:

- `GET /api/cluster` — current `ClusterModel` snapshot.
- `GET /api/events` — Server-Sent Events stream; pushes a full snapshot on
  every change.
- `GET /api/health` — liveness check.

**Mutations (Phase 3+ — no auth, same trust model as the read routes):**

- `POST /api/devices` body `{ "deviceId": "...", "name": "...", "nodes":
  ["<node device ID>", ...] }` — adds the device as a peer in each named
  registered node's config.
- `POST /api/folders` body `{ "folderId": "...", "label": "...", "path":
  "~/...", "type": "sendreceive", "devices": ["<node device ID>", ...] }` —
  creates the folder on each named registered node, shared among all of
  them. `path` defaults to `~/<folderId>` on every node; per-node paths and
  types can be adjusted afterwards with the folder-scoped routes below.

- `POST /api/devices/:deviceId/pause` / `.../resume` — pauses/resumes *every*
  registered node's connection to that device (mirrors clicking pause in each
  of those nodes' own Syncthing GUIs). Works even for a device we don't hold
  keys for ourselves, as long as some registered node has it configured as a
  peer; 409 if no registered node references it at all.
- `POST /api/folders/:folderId/devices/:deviceId/pause` / `.../resume` —
  pauses/resumes that folder on that specific registered node.
- `POST /api/folders/:folderId/devices/:deviceId/rescan` — triggers an
  immediate rescan of that folder on that node.
- `PATCH /api/folders/:folderId/devices/:deviceId` body
  `{ "type": "sendonly" }` — changes that folder's type on that node.
- `POST /api/folders/:folderId/devices/:deviceId/shares` body
  `{ "deviceId": "..." }` — adds a device to that folder's share list on that
  node.
- `DELETE /api/folders/:folderId/devices/:deviceId/shares/:targetDeviceId` —
  removes a device from that folder's share list on that node.

`:deviceId` here is always a registered node's own Syncthing device ID — the
same value as a Share's `deviceId` in the normalized model, since Phase 2's
aggregation only ever produces Share rows from a node's first-hand view of
its own folders.

`CLUSTERFUCK_WEB_ORIGIN` (default `http://localhost:5173`) sets the CORS
origin allowed to read these routes — only needed if the frontend talks to
the proxy directly instead of through Vite's dev proxy (`packages/web`
forwards `/api/*` to `http://localhost:4000` in dev, so in normal local dev
you won't hit CORS at all).

`CLUSTERFUCK_CONFIG` overrides the node-config file path (default
`./dev-cluster.json`, resolved relative to the process's cwd).

## Notes

- Runs `.ts` source directly via Node's native type stripping — no build
  step, no bundler/ts-node. `pnpm typecheck` still gates correctness.
- Targets the Syncthing 1.x REST shape (see `src/syncthing/types.ts`).
