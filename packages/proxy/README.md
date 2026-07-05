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
- `GET /api/version` — `{ "version": "x.y.z" }` from this process's own
  `package.json`. Compare against the frontend build's version (shown next to
  its logo) to catch a stale proxy process serving routes an updated frontend
  expects — the generic 404 that produces is otherwise hard to diagnose.

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
- `DELETE /api/devices/:deviceId` — same fan-out scope as pause: removes the
  device as a peer from *every* registered node that has it configured (never
  from the device's own config — there's no "remove yourself"). Syncthing
  also drops it from any folder it was shared on for that node.
- `POST /api/folders/:folderId/devices/:deviceId/pause` / `.../resume` —
  pauses/resumes that folder on that specific registered node.
- `POST /api/folders/:folderId/devices/:deviceId/rescan` — triggers an
  immediate rescan of that folder on that node.
- `PATCH /api/folders/:folderId/devices/:deviceId` body
  `{ "type": "sendonly" }` — changes that folder's type on that node.
- `POST /api/folders/:folderId/devices/:deviceId/shares` body
  `{ "deviceId": "...", "encryptionPassword": "..." }` (`encryptionPassword`
  optional) — adds a device to that folder's share list on that node. Set
  `encryptionPassword` to make the added peer untrusted/`receiveencrypted` on
  its own side; omit it for a normal trusted share. Also doubles as "set/change
  the password on an already-shared device" — calling this again for a device
  already on the list just updates its entry. An explicit empty string clears
  a previously-set password; omitting the field leaves it as-is.
  `encryptionPassword` is write-only — it's never read back into the
  normalized model or any response.
- `DELETE /api/folders/:folderId/devices/:deviceId/shares/:targetDeviceId` —
  removes a device from that folder's share list on that node.
- `DELETE /api/folders/:folderId/devices/:deviceId` — removes the folder from
  that one node's config only, not cluster-wide (does not touch the data on
  disk). Remove it from the other sharing nodes separately if that's what you
  want.

**Cluster-wide (Phase 5's first bulk actions):**

- `POST /api/devices/all/pause` / `.../resume` — pauses/resumes every device
  every registered node knows about, skipping each node's own self-entry (one
  refresh for the whole batch, not one per device; a partial failure still
  applies to and refreshes the rest, and is reported by node→device label,
  capped to 5 shown).
- `POST /api/folders/all/pause` / `.../resume` — same, but for every folder on
  every registered node that has it.

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
