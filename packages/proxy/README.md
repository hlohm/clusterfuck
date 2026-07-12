# @clusterfuck/proxy

The thin backend between the frontend and one or more Syncthing nodes. Holds
API keys, aggregates each node's own view into one normalized `ClusterModel`
(`@clusterfuck/shared`), and serves it read-only over HTTP + Server-Sent
Events. See [`ROADMAP.md`](../../ROADMAP.md) (Phase 2) for the decisions behind
this design.

## Setup

```sh
cp cluster.example.json cluster.json
# edit cluster.json with your nodes' URLs and API keys
```

`cluster.json` is gitignored — never commit real endpoints or keys. It's the
one canonical node registry: read at startup, and kept in sync automatically
when nodes are registered/removed at runtime (see the `/api/nodes` routes
below) — you only need to hand-edit it to get the first node or two in.

## Run

```sh
pnpm --filter @clusterfuck/proxy dev   # from the repo root
# or, from this directory:
pnpm dev
```

Listens on `PORT` (default `4000`).

## Auth

(Plain-language explainer: [docs/HOW-AUTH-WORKS.md](../../docs/HOW-AUTH-WORKS.md).)

Opt-in: configure a token and every `/api/*` route requires it — except
`GET /api/health`, `GET /api/version`, `GET /api/auth`, and `POST /api/login`
(the handshake itself). With no token the proxy runs open (a loud startup
warning says so) — fine on localhost, never expose that beyond a trusted
network.

**Two ways to set the token, one authoritative:**

- **`CLUSTERFUCK_TOKEN` env var** — when set (and non-empty), it wins. The
  GUI treats auth as read-only (reveal/copy + sign out only); rotating means
  changing the env var and restarting.
- **`auth.json`** — when the env var is unset, the proxy reads/writes a
  gitignored `auth.json` (raw token, `{ "token": "..." }`, written mode
  0600 via a temp-file rename). This is what the GUI manages: it can
  initialise auth on an open proxy, rotate, or auto-generate a strong token.
  `CLUSTERFUCK_AUTH_CONFIG` overrides the path (default `./auth.json`,
  relative to cwd). **Disabling auth is deliberately out-of-band:** the GUI
  can't do it — delete `auth.json` (or unset the env var) and restart, so a
  hijacked browser session can never reopen the door.

- **Scripts/curl:** send `Authorization: Bearer <token>` per request.
- **Browsers:** the web app shows a login screen; `POST /api/login` body
  `{ "token": "..." }` sets an HttpOnly `SameSite=Strict` session cookie
  (the SSE stream authenticates through it — EventSource can't send
  headers). The cookie value is a stateless HMAC derived from the token:
  proxy restarts don't log anyone out, and rotating the token instantly
  invalidates every outstanding session. No `Secure` attribute (plain-HTTP
  LAN deployments are the norm) — put HTTPS in front if you need it.
- `GET /api/auth` — `{ "required": bool, "authorized": bool, "managedByEnv":
  bool }`, uncredentialed. `managedByEnv` tells the GUI whether it may manage
  the token or must defer to the environment.
- `GET /api/auth/token` — `{ "token": "..." }`, **authorized callers only**:
  the GUI's "show access token" reveal for signing in on another browser
  (same stance as Syncthing's own GUI displaying its API key).
- `PUT /api/auth/token` — sets the token (initialise or rotate). Body
  `{ "token": "..." }` sets that token (min 16 chars), or `{}` has the proxy
  **generate** a strong one; the response `{ "token": "..." }` carries the
  now-current value to display, and a fresh session cookie signs the caller
  in. Persists to `auth.json`. Returns **409** when the token is
  `managedByEnv` (change the env var instead), **400** on a too-short token.
  When auth is currently *open* this route is ungated (that's how you turn it
  on); once auth is enabled only a signed-in admin can rotate.
- `POST /api/logout` — clears the session cookie. Deliberately exempt from
  the gate: a browser whose session was just revoked must still be able to
  clear its cookie.

## Static web app

When `packages/web/dist` exists (run `pnpm build`), the proxy serves it —
production is then one process on one origin, no CORS or cookie contortions.
Unknown non-`/api` paths fall back to `index.html`; `/api/*` misses stay
hard 404s (the stale-proxy diagnostic). Override the directory with
`CLUSTERFUCK_WEB_DIST`; without a build the proxy is API-only, as before.

## Routes

- `GET /api/cluster` — current `ClusterModel` snapshot.
- `GET /api/events` — Server-Sent Events stream; pushes a full snapshot on
  every change.
- `GET /api/changes` — the cluster-wide recent-changes feed, newest first:
  `{ "changes": [{ "nodeId": "...", "folderId": "...", "path": "...",
  "action": "modified", "itemType": "file", "origin": "local" | "remote",
  "modifiedBy": "...", "time": "..." }] }`. Fed by each node's
  `/rest/events/disk` stream into a bounded in-memory buffer (last 200) —
  a "what just happened" glance, not a persisted audit log; empty after a
  proxy restart.
- `GET /api/history/completion` — recent completion samples per share, for
  the overview sparklines: `{ "series": [{ "folderId": "...", "deviceId":
  "...", "points": [{ "t": 1720000000000, "pct": 63 }] }] }`. Sampled on the
  proxy's refresh cycle (at most one point per share per 30s, last 120
  points ≈ 1.5h); in-memory and bounded like `/api/changes` — a sparkline's
  worth, not a metrics store.
- `GET /api/events/log` — the merged raw event log, newest first: every
  Syncthing event the proxy's per-node event loops receive (default and
  disk streams alike), with the raw `data` payload untouched. Query params:
  `?types=StateChanged,FolderSummary` (comma-separated), `?node=<device
  ID>`, `?limit=N`. Bounded (last 300) and in-memory — a diagnostic glance,
  not an audit trail. Distinct from `GET /api/events`, the SSE model
  stream.
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
- `GET /api/devices/:deviceId/qr` — PNG QR code of the device ID, relayed
  from the first reachable registered node's own `/qr/` GUI endpoint (the
  same renderer Syncthing's web UI uses — no QR library here). Restricted to
  device IDs actually present in the model (configured or pending), so it
  can't be used to render arbitrary text; 400 otherwise.
- `GET /api/devices/:deviceId/options` — how every registered node that
  references the device currently has it configured: `{ "deviceId": "...",
  "nodes": [{ "nodeId": "<node device ID>", "options": { "name": "...",
  "addresses": ["dynamic"], "compression": "metadata", "introducer": false,
  "autoAcceptFolders": false, "maxSendKbps": 0, "maxRecvKbps": 0 } }] }`.
  Same fan-out scope as pause/remove (never the device's own self-entry);
  a node whose entry couldn't be read gets an `error` string instead of
  failing the whole call. On-demand — entries can differ per node and are
  deliberately not part of the aggregated model.
- `PUT /api/devices/:deviceId/options` body = one `options` object as above —
  applies the same options on *every* referencing node (the UI warns first
  when nodes currently disagree). All fields required; `compression` one of
  `metadata`, `always`, `never`; `addresses` a non-empty list (`["dynamic"]`
  for discovery); rate limits integers ≥ 0 (0 = unlimited). Uses Syncthing's
  element-scoped PATCH per node, so unmodeled fields (paused,
  allowedNetworks, ...) are untouched.
- `POST /api/folders/:folderId/devices/:deviceId/pause` / `.../resume` —
  pauses/resumes that folder on that specific registered node.
- `POST /api/folders/:folderId/devices/:deviceId/rescan` — triggers an
  immediate rescan of that folder on that node.
- `POST /api/folders/:folderId/devices/:deviceId/override` — on a `sendonly`
  folder: pushes that node's local version out, overriding remote changes.
- `POST /api/folders/:folderId/devices/:deviceId/revert` — on a `receiveonly`
  folder: discards that node's local-only changes in favor of the cluster's
  version. Both pass Syncthing's own error through if the folder type doesn't
  match.
- `PATCH /api/folders/:folderId/devices/:deviceId` body
  `{ "type": "sendonly", "label": "Photos" }` (at least one of the two) —
  changes that folder's type and/or label on that node, in one config
  round-trip. Labels are per-node, which is exactly what the drift
  detector's rename fix edits.
- `PUT /api/folders/:folderId/devices/:deviceId/versioning` body
  `{ "type": "simple", "params": { "keep": "5" }, "cleanupIntervalS": 3600 }`
  (`params`/`cleanupIntervalS` optional) — sets that folder's file-versioning
  config on that node. `type` is one of `none`, `trashcan`, `simple`,
  `staggered`, `external` (`none` maps to Syncthing's own "versioning off");
  `params` are Syncthing's raw string knobs, kept verbatim (e.g. `keep`,
  `cleanoutDays`, `maxAge` in *seconds* for staggered, `command` for external).
  `fsPath`/`fsType` and other fields we don't model are preserved on the
  round-trip.
- `PUT /api/folders/:folderId/devices/:deviceId/options` body
  `{ "rescanIntervalS": 3600, "fsWatcherEnabled": true, "fsWatcherDelayS": 10,
  "minDiskFree": { "value": 1, "unit": "%" } }` — sets that folder's advanced
  options on that node. All four fields are required (send the current values
  back for the ones you're not changing — the UI's editor does). Constraints:
  `rescanIntervalS >= 0` (0 disables periodic rescans), `fsWatcherDelayS > 0`,
  `minDiskFree.value >= 0` (0 disables the free-space check) with `unit` one
  of `%`, `kB`, `MB`, `GB`, `TB`. Everything else on the folder config is
  preserved on the round-trip.
- `GET /api/folders/:folderId/failed-items` — every registered node that
  shares the folder, each with the items its last pull failed on:
  `{ "folderId": "...", "nodes": [{ "deviceId": "...", "items": [{ "path":
  "...", "error": "..." }] }] }`. The aggregated model carries only the
  per-share `failedItems` *count*; this is the on-demand detail behind it. A
  node whose list couldn't be read gets an `error` string instead of failing
  the whole call.
- `GET /api/folders/:folderId/conflicts` — scans every sharing node's view of
  the folder tree (`/rest/db/browse`) for Syncthing conflict copies
  (`*.sync-conflict-<date>-<time>-<device>*`): `{ "folderId": "...", "nodes":
  [{ "deviceId": "...", "paths": ["sub/file.sync-conflict-....txt"] }] }`.
  On-demand only and deliberately behind an explicit UI button — the browse
  call returns the node's whole tree, which can be heavy on large folders.
- `GET /api/folders/:folderId/ignores` — every registered node that shares the
  folder, each with its own `.stignore` patterns (raw lines):
  `{ "folderId": "...", "nodes": [{ "deviceId": "...", "patterns": ["*.tmp"] }] }`.
  A node whose patterns couldn't be read gets an `error` string and empty
  `patterns` instead of failing the whole call. On-demand only — ignore lists
  are per-node and can be large, so they're deliberately **not** part of the
  aggregated `ClusterModel`/SSE snapshot.
- `PUT /api/folders/:folderId/devices/:deviceId/ignores` body
  `{ "patterns": ["*.tmp", "/build"] }` — replaces that folder's `.stignore`
  patterns on that node.
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
- `POST /api/folders/all/rescan` — triggers a rescan of every folder on every
  registered node (same batch/reporting shape as pause all).
- `GET /api/bandwidth` — every registered node's *global* bandwidth caps:
  `{ "nodes": [{ "nodeId": "...", "maxSendKbps": 0, "maxRecvKbps": 0 }] }`
  (KiB/s, 0 = unlimited; per-node `error` captured). Distinct from the
  per-device limits in the device options.
- `PUT /api/bandwidth` body `{ "maxSendKbps": 0, "maxRecvKbps": 0 }` — sets
  those caps on **every** registered node; `PUT
  /api/nodes/:deviceId/bandwidth` (same body) on one node. Integers ≥ 0;
  element-scoped PATCH of `/rest/config/options`, all other global options
  untouched.
- `POST /api/upgrade` — starts an upgrade sweep: every registered node,
  strictly one at a time; each is checked (`/rest/system/upgrade`), upgraded
  only if a newer release exists, and must come back reachable (health
  check, 5-minute default timeout) before the next node starts. A failure
  aborts the remaining nodes. Returns immediately; one run at a time (400
  if one is already in progress). Nodes not built with upgrade support
  (distro packages) fail their step with Syncthing's own error. A node whose
  only available upgrade crosses a **major version** (1.x → 2.x) is reported
  as `major-available` and skipped — send body `{ "includeMajor": true }`
  to deliberately cross it (the UI confirms this separately).
- `GET /api/upgrade` — the current/most recent run, mutating live:
  `{ "run": { "running": true, "aborted": false, "nodes": [{ "nodeId":
  "...", "status":
  "pending|checking|up-to-date|upgrading|done|failed|skipped|major-available",
  "fromVersion": "...", "toVersion": "...", "detail": "..." }] } }` (`run`
  is `null` before the first sweep; in-memory only, gone after a proxy
  restart).
- `POST /api/nodes/:deviceId/restart` / `.../shutdown` — restarts or shuts
  down that one node's Syncthing process. Restart comes back on its own;
  shutdown does **not** (start it on the machine itself). The connection
  dropping mid-call is treated as success — Syncthing may exit before its
  response gets out — but an explicit HTTP error still fails.

**Pending devices & folders (the cluster-wide "inbox"):** surfaced as
`pendingDevices`/`pendingFolders` on the `ClusterModel` itself (merged across
every registered node that reports them — the same device or folder trying
more than one node shows up once, not N times), plus these routes:

- `POST /api/pending/devices/:deviceId/accept` body `{ "name": "...", "nodes":
  ["<node device ID>", ...] }` — configures the device as a peer on the named
  nodes (identical effect to `POST /api/devices`; this is a thin alias so
  accepting from the inbox doesn't need a second code path).
- `DELETE /api/pending/devices/:deviceId` — dismisses the pending-device
  notification on every registered node currently reporting it. Not
  permanent: the same device trying to connect again will resurface it. For
  a permanent ignore, the device should be added to that node's ignore list
  directly (not exposed here yet).
- `POST /api/pending/folders/:folderId/devices/:nodeId/accept` body
  `{ "offeredBy": "<device ID>", "label": "...", "path": "~/...", "type":
  "sendreceive" }` (`label` optional, defaults to the folder id; `type`
  optional, defaults to `sendreceive`) — joins the folder on `:nodeId`,
  shared with the offering device. Single-node only: this is *not* the same
  as `POST /api/folders`, since the offer was made to one specific node by
  one specific (possibly unmanaged) peer, not a fan-out across chosen nodes.
  Rejects (400) unless `offeredBy` is currently offering exactly this folder
  on `:nodeId`, per the same node's own pending-folders list — a caller can't
  point this at an arbitrary device. If that offer has `receiveEncrypted:
  true`, `type` must be `receiveencrypted` (also rejected with 400 otherwise)
  — the frontend locks the type selector to match, but the API enforces it
  independently.
- `DELETE /api/pending/folders/:folderId/devices/:nodeId` query
  `?offeredBy=<device ID>` (optional) — dismisses the pending-folder
  notification on that one node; narrows to a single offering device if
  given, otherwise dismisses every offer of that folder on that node.

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
`./cluster.json`, resolved relative to the process's cwd) — both reads at
startup and writes from runtime node registration use this same path.

## Notes

- Runs `.ts` source directly via Node's native type stripping — no build
  step, no bundler/ts-node. `pnpm typecheck` still gates correctness.
- Targets the Syncthing 1.x REST shape (see `src/syncthing/types.ts`).
