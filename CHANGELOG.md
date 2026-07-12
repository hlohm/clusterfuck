# Changelog

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning policy is in `CLAUDE.md`; the phased feature history is in
`ROADMAP.md` — this file is the terse, dated version-by-version log.

## [0.4.39]

- **The upgrade sweep never crosses a Syncthing major silently** (ROADMAP
  "Syncthing 2.x support", third item). On a 1.x node the upgrade check can
  offer 2.x as `latest` — previously "Upgrade all nodes" would install it
  like any other update. A node whose available upgrade crosses a major is
  now reported as `major-available` and skipped (not a failure; the sweep
  continues), and crossing it is its own deliberate path:
  `POST /api/upgrade` body `{ "includeMajor": true }`, offered in the UI as
  a separate danger-styled button (only after a sweep has reported a major)
  with its own confirmation spelling out the 2.0 database migration.

## [0.4.38]

- **Syncthing 2.x response-shape compatibility** (ROADMAP "Syncthing 2.x
  support", second item). Fixed while pinning shapes with tests: Syncthing
  1.x lists the local device itself in `/rest/system/connections` as a
  permanently not-connected entry, and the snapshot passed it through —
  a false "not connected" vote on the node's own aggregated state and a
  self-loop connection edge; both majors now normalize to the 2.x shape
  (self entry dropped). `db/status`'s `errors` is optional (2.x omits it;
  `pullErrors` preferred, as before). `syncthing/types.ts` now records
  per-endpoint 1.x/2.x compat notes verified against the official docs
  diffed across the 2.0 boundary, replacing its "targets 1.x" disclaimer.

## [0.4.37]

- **Per-node Syncthing versions are first-class in the UI** (ROADMAP
  "Syncthing 2.x support", first item): each node card in the Overview shows
  the version that node reports about itself (already carried in
  `Device.systemStatus`), and when the cluster's managed nodes span more
  than one major — normal mid-migration — the Nodes section says so
  explicitly. New pure helpers `parseSyncthingMajor`/`syncthingMajors` in
  `@clusterfuck/shared`; the edge-cases fixture is now a mixed 1.x/2.x
  cluster and the coverage test enforces one exists.

## [0.4.36]

- Roadmap: the **Syncthing 2.x support** decision is settled — per-node
  version detection (owner, 2026-07-11; the live cluster is already mixed
  1.x/2.x) — and the leg is itemized in `ROADMAP.md`, shipping as 0.5.0:
  per-node version in the model/UI, 2.x response-shape compatibility tests
  (with the researched endpoint deltas recorded), and a major-version gate
  for the upgrade sweep (which today would silently jump 1.x→2.x). A
  **review & live-cluster hardening** leg follows 0.5, starting with a
  safe-testing strategy to be devised with the owner. Phase 6 stays parked.

## [0.4.35]

- Post-review polish, three small items:
  - The Settings overlay's env-managed token reveal has a **Hide** button
    again (the file-managed branch already did) — once shown, the token no
    longer stays on screen until the dialog closes.
  - The fetch layer tolerates an empty success body instead of throwing on
    JSON parse — defuses a latent trap for any future 204-style route.
  - Collapsed-section ids in the persisted Overview layout are pruned
    against the live section list on save, so sections removed in a later
    build don't accumulate in localStorage forever.
## [0.4.34]

- **Fixed: a cancelled sidebar drag left the resize listeners attached.**
  The graph view's divider only cleaned up its window-level `pointermove`/
  `pointerup` listeners on `pointerup`; a `pointercancel` (touch drag
  interrupted by a scroll gesture, browser takeover) never fired it, so the
  sidebar kept resizing with every later pointer movement. The drag wiring
  now lives in `sidebarResize.ts` (unit-tested) and detaches on both.
## [0.4.33]

- **Request bodies are capped at 1 MiB** (413 beyond it). The proxy buffered
  JSON bodies without a limit, and two body-reading routes are reachable
  without credentials (`POST /api/login`, and `PUT /api/auth/token` on a
  still-open proxy) — so anyone who could reach the port could stream
  arbitrary data into proxy memory. Oversize declared lengths are rejected
  before reading; chunked transfers are cut off at the cap mid-stream.
## [0.4.32]

- **Fixed: setting/rotating the auth token no longer reports success when
  the write to `auth.json` fails.** Previously the in-memory token changed
  and the failure was only logged, so `PUT /api/auth/token` answered 200
  with a token the next restart would silently revert — locking out anyone
  who had discarded the old one. `setToken` now persists *before* mutating
  state; on failure the route answers 500 and the previous token (and every
  session under it) stays active.
## [0.4.31]

- Overview and Table views are horizontally centered (`margin-inline: auto`
  on their max-width containers) instead of hugging the left edge on wide
  windows. The table keeps its 1100px cap — it moved from the table element
  to the `.table-view` container so the whole view centers as one block.

## [0.4.30]

- **Fixed: the graph detail panel's "Show QR" button duplicated as you
  clicked from device to device.** `DeviceQr` was keyed among unkeyed
  sibling elements, so when the key changed on each new selection React
  failed to unmount the previous instance and the control accumulated (one
  extra per device visited). The panel is now keyed by the selection
  identity (`device:…` / `folder:…` / `share:…`) and remounts wholesale on
  every selection change — one QR control again, and per-editor state
  (loaded device/folder options, ignore patterns, the QR toggle) resets on
  switch instead of leaning on scattered, fragile per-child keys.

## [0.4.29]

- **Overview sections are collapsible and re-arrangeable** (ROADMAP "UI
  design refinement", final item): every section below the KPI row —
  cluster actions, bandwidth, upgrades, recent changes, event log, needs
  attention, config drift, pending, nodes, folders — now renders in one
  shared `OverviewSection` frame with a collapse toggle and move-up/down
  controls. Collapse state and order persist per browser; a saved order
  survives app upgrades (new sections slot into their default position
  instead of shuffling the layout), and moves skip over currently-empty
  sections. The pure layout logic (`sectionLayout.ts`) is unit-tested.
  With this, the pre-1.0 UI refinement leg is complete.

## [0.4.28]

- **Manage auth from the GUI** (ROADMAP Phase 5 foundations): a new Settings
  overlay (⚙ in the header) makes the whole auth lifecycle click-driven —
  **initialise** auth on an open proxy, **rotate** the token, or
  **auto-generate** a strong one, no terminal or restart. New
  `PUT /api/auth/token` (body `{ token }` to set, `{}` to generate; min 16
  chars; 409 when env-managed) sets the token and signs the caller in with a
  fresh cookie. The token persists in a gitignored `auth.json` (raw, mode
  0600, written via temp-file rename; `CLUSTERFUCK_AUTH_CONFIG` to relocate)
  when `CLUSTERFUCK_TOKEN` is unset — the env var stays **authoritative**,
  and the GUI then only reveals/copies it and signs out (`GET /api/auth` now
  also returns `managedByEnv`). The proxy's auth object became a stateful
  manager so routes pick up rotation live. **Disabling** auth is deliberately
  out-of-band (remove the auth file/env var + restart) — the GUI can tighten
  the lock but never open it, so a hijacked session can't. The old Overview
  "Access token" row moves into the overlay. Docs: proxy README auth section
  + `PUT /api/auth/token`, a "Managing auth from the GUI" section in
  `docs/HOW-AUTH-WORKS.md`, README security note, and a 2.0 **multi-user
  auth** roadmap pillar paired with multi-cluster.

## [0.4.27]

- **React Flow attribution legible in dark mode** (ROADMAP "UI design
  refinement"): the corner attribution now sits on a translucent chip of
  the app's own background color with theme-aware text, instead of the
  library's light-only default. Kept, only restyled.

## [0.4.26]

- **Folder editing view legibility** (ROADMAP "UI design refinement",
  first item): the graph view's detail sidebar is now **re-sizable** — drag
  the divider (or focus it and use ←/→), width persisted per browser — and
  the per-share **Versioning** and **Advanced** editors are fold-outs,
  collapsed by default with a one-line summary of the current config in the
  header, so pause/rescan/type and the share list stay above the fold.
  New `data/localPrefs.ts` localStorage helper (namespaced, corrupt-value
  safe) shared by the upcoming overview-layout persistence.

## [0.4.25]

- Docs: **[docs/HOW-AUTH-WORKS.md](docs/HOW-AUTH-WORKS.md)** — a
  non-programmer explainer of the auth system (why a token, why a cookie,
  what the cookie actually contains, second browsers via the GUI reveal,
  scripts, what stays open, session expiry, honest limits), companion to
  HOW-IT-WORKS.md. The README's Security note no longer claims the proxy
  has no authentication (it predated 0.4.22) and now leads with the
  one-process deployment; CLAUDE.md's status line likewise catches up.
- Roadmap: new **UI design refinement (pre-1.0)** leg — re-sizable folder
  detail with fold-out Versioning/Advanced sections, a dark-mode-legible
  React Flow attribution, and collapsible, re-arrangeable Overview
  sections.

## [0.4.24]

- **Fixed: a tied label vote produced a one-click rename to an arbitrary
  winner** (code review of 0.4.20). With no majority (e.g. two nodes
  "Photos", two "Pics") the drift finding now carries only a "pick one
  yourself" suggestion, honoring DriftFix's contract that human-choice
  cases stay text-only.
- **Static-serving hardening** (code review of 0.4.22): malformed
  percent-encoding (`GET /%`) is a 404 instead of a `decodeURIComponent`
  500; a missing file *with an extension* (a stale hashed asset after a
  redeploy) is a hard 404 instead of index.html masquerading as JavaScript;
  reads are async (`fs.promises`) so a large asset can't stall the event
  loop that fans out SSE frames; one `statSync(..., { throwIfNoEntry:
  false })` replaces the exists/stat pair (no TOCTOU throw); hashed
  `/assets/*` get `Cache-Control: immutable` while index.html always
  revalidates.
- The proxy warns at startup when `CLUSTERFUCK_WEB_ORIGIN='*'` — browsers
  reject wildcard origins for credentialed requests, so that value can't
  work with cookie auth.

## [0.4.23]

- **Fixed: losing your session wedged the app until a manual reload** (code
  review of 0.4.22's auth). The web app's fetch layer is now one shared
  module (`data/http.ts`) with a global 401 hook: any request answered 401 —
  cookie expired, token rotated — flips the app back to the login screen
  instead of stranding it on inline "authentication required" errors. The
  SSE stream (which can't see HTTP statuses, and which a 401 closes for
  good despite the old "retrying…" message) now probes the auth status on
  error to tell de-auth apart from a real connection drop, and reconnects
  automatically after re-login.
- **Fixed: Sign out silently did nothing when the session was already
  invalid.** `POST /api/logout` is now auth-exempt (clearing a cookie needs
  no valid session) and the button reloads into the auth gate even if the
  request fails.
- The drift rows reuse the Overview's device-name lookup instead of
  rebuilding a per-row map on every render.

## [0.4.22]

- **Auth on the proxy** (ROADMAP.md Phase 5 Foundations — the 1.0 gate):
  opt-in shared token via `CLUSTERFUCK_TOKEN`. Scripts authenticate with
  `Authorization: Bearer <token>`; browsers enter the token once at a new
  login screen and get an HttpOnly `SameSite=Strict` session cookie (the
  SSE stream rides it, since EventSource can't send headers). The cookie is
  a stateless HMAC of the token — restarts don't log sessions out, rotating
  the token revokes them all. Timing-safe comparisons throughout. The
  Overview's cluster-actions card gains an **Access** row: reveal/copy the
  token for signing in on another browser (authorized-only route,
  `GET /api/auth/token`) and Sign out. Unset, the proxy runs open exactly
  as before, with a loud startup warning.
- **The proxy serves the built web app** (`packages/web/dist`, override with
  `CLUSTERFUCK_WEB_DIST`): production is one process on one origin, so
  cookies need no CORS/SameSite contortions. SPA fallback for non-API
  paths; `/api/*` misses stay hard 404s (the stale-proxy diagnostic);
  path-traversal refused. Without a build the proxy stays API-only.

## [0.4.21]

- Docs refresh, no code changes: README's feature list now covers the
  0.4.8–0.4.20 additions (advanced folder options, device options, QR,
  cluster operations incl. upgrades and bandwidth caps, the observability
  suite, one-click drift fixes); ROADMAP/CLAUDE.md status lines state that
  Phase 5's four feature sections are complete and only the flagged
  foundations (proxy auth, Syncthing 2.x) remain.

## [0.4.20]

- **One-click drift fixes** (follow-up promised in 0.4.13): drift findings
  whose fix maps onto an existing safe mutation now carry a
  machine-applicable `fix` payload and an **Apply fix** button (live source
  only, confirmation-gated): label drift renames the outlier nodes' copies
  to the majority label, and an asymmetric share adds the missing
  share-back entry on the node that lacks it. Findings that need a human
  choice (which node becomes the writer, what path a missing folder gets)
  deliberately stay text-only. The folder PATCH route accepts `label`
  alongside `type` (labels are per-node — the same fact that makes label
  drift detectable makes it fixable per node).

## [0.4.19]

- **Raw event log** (ROADMAP.md Phase 5 Observability — the section's last
  item): every Syncthing event both proxy event loops receive (default +
  disk streams) now also lands in a bounded in-memory log (last 300),
  merged across nodes and served newest-first at `GET /api/events/log`
  (`?types=`, `?node=`, `?limit=` filters). The Overview gains an Event log
  card with client-side type/node filtering and the raw payload shown
  per row — the diagnostic view behind the friendlier recent-changes feed.

## [0.4.18]

- **Completion sparklines** (ROADMAP.md Phase 5 Observability): the
  Overview's folder cards now draw a tiny completion-over-time line per
  share, next to the existing meter. The proxy samples each share's
  completion on its refresh cycle — at most one point per 30s, last 120
  points (~1.5h), in-memory like the recent-changes feed — served at
  `GET /api/history/completion` and fetched quietly by the Overview every
  30s (live source only; a fetch failure just means no lines). The y-scale
  is a fixed 0–100%: rescaling to a series' own min/max would turn a
  99→100% wiggle into a cliff. Completes the Phase 5 Observability section
  except the raw event log.

## [0.4.17]

- **Upgrade orchestration** (ROADMAP.md Phase 5 Cluster operations — the
  last item of that section): `POST /api/upgrade` starts a background sweep
  on the proxy that upgrades every registered node **one at a time** — each
  node is version-checked first (already-current nodes are skipped),
  upgraded via Syncthing's own `/rest/system/upgrade`, and must come back
  reachable before the next node starts; a node that fails (or never comes
  back within the timeout) aborts the remainder, so at most one node is
  ever mid-upgrade. `GET /api/upgrade` serves the run's live per-node
  progress; one run at a time, in-memory only. The Overview gains an
  Upgrades card that starts a sweep (confirmation-gated) and polls progress
  while it runs. The connection dropping as a node restarts mid-upgrade is
  treated as success, same as the restart action.

## [0.4.16]

- **Recent-changes feed** (ROADMAP.md Phase 5 Observability): a Recent
  changes card on the Overview shows what just changed across the whole
  cluster — action, path, folder, observing node, and for remote changes
  the peer it came from. The proxy long-polls each node's
  `/rest/events/disk` stream (a second event loop per node — Syncthing
  doesn't deliver `LocalChangeDetected`/`RemoteChangeDetected` on the
  default stream) into a bounded in-memory buffer (200 entries), served
  newest-first at `GET /api/changes`. Deliberately not persisted and not
  part of the SSE model: it's a glance backwards, not an audit log. The
  raw filterable event log is split out as its own roadmap item.

## [0.4.15]

- **Live transfer rates** (ROADMAP.md Phase 5 Observability): `Connection`
  gains `inBps`/`outBps`, estimated by the proxy from the change in
  Syncthing's cumulative per-connection counters between refresh cycles
  (the REST API exposes no rate itself). Sampling rules: no rate until two
  readings ≥2s apart exist (event-triggered refreshes can land
  back-to-back — shorter windows carry the previous rate forward), a
  counter reset reads as 0 rather than a negative rate, and disconnected
  links have no rate. Shown per connection and as a "now ↑/↓" summary on
  the device panel's transfer line and the Overview's data-transferred
  tile.

## [0.4.14]

- **Cluster-wide bandwidth limits** (ROADMAP.md Phase 5 Cluster operations):
  a Bandwidth-limits card on the Overview shows each node's global
  send/receive caps (loaded on demand from `/rest/config/options` — not
  model state) and sets them on one node ("Apply here") or every registered
  node in one confirmation-gated action. New routes `GET`/`PUT
  /api/bandwidth` and `PUT /api/nodes/:deviceId/bandwidth`; element-scoped
  PATCH keeps every other global option untouched. These are the node-global
  caps — per-device limits shipped in 0.4.10's device options editor.
  Closes out the Phase 5 "Cluster operations" list except upgrade
  orchestration.

## [0.4.13]

- **Config drift detection** (ROADMAP.md Phase 5 Cluster operations) — the
  cluster-level check a single-node GUI can't do. New pure `detectDrift()`
  in `@clusterfuck/shared`, surfaced as a "Config drift" section on the
  Overview (fixtures included): differing folder labels across nodes (with
  a rename-to-majority suggestion), differing file-versioning configs
  (info-level — per-node versioning is legal), all-sendonly ("no reader")
  and all-receiveonly ("no writer") folders, and asymmetric shares — A
  shares with managed B but B doesn't share back, or doesn't have the
  folder at all. Each finding carries a concrete suggested fix (advisory
  text). `Share` gains `label` (each node's own label for the folder),
  which aggregation previously discarded — without it label drift is
  undetectable. Encrypted relays are excluded from type checks; pairwise
  type differences are deliberately not flagged (normal topology).

## [0.4.12]

- **Rescan all + node restart/shutdown** (ROADMAP.md Phase 5 Cluster
  operations): `POST /api/folders/all/rescan` rescans every folder on every
  registered node as one batch (same reporting as pause all), surfaced as a
  Rescan-all button in the Overview's cluster actions. `POST
  /api/nodes/:deviceId/restart|shutdown` controls one node's Syncthing
  process from the device detail panel — both confirmation-gated, shutdown
  with an explicit "won't come back until started on the machine" warning.
  A connection dropping mid-restart counts as success (Syncthing can exit
  before its response gets out); an explicit HTTP error still fails. The
  remaining piece of that roadmap line, upgrade orchestration, is split out
  as its own item.

## [0.4.11]

- **Device identity QR** (ROADMAP.md Phase 5 Device management): the device
  detail's ID line gains a Show QR toggle. New route
  `GET /api/devices/:deviceId/qr` relays the PNG from a registered node's
  own `/qr/` GUI endpoint (the same renderer Syncthing's web UI uses), with
  fallback across nodes — no QR library added to proxy or frontend. IDs are
  validated against the model so the route can't render arbitrary text.
  Completes the "device identity" roadmap item started by 0.4.6's copy
  button.

## [0.4.10]

- **Edit device options** (ROADMAP.md Phase 5 Device management): name,
  addresses, compression, introducer, auto-accept folders, and per-device
  send/receive rate limits. New routes
  `GET`/`PUT /api/devices/:deviceId/options` — the GET shows how *every* referencing
  registered node currently configures the device (on-demand, not in the
  model: entries can legitimately differ per node), the PUT applies one set
  of options to all of them (same fan-out scope as pause/remove, never the
  device's own self-entry) via Syncthing's element-scoped config PATCH so
  unmodeled fields stay untouched. The device detail panel gains a "Device
  options" editor with a "nodes configure this differently" warning before
  a divergent config gets flattened.

## [0.4.9]

- **Conflict & failed-item surfacing** (ROADMAP.md Phase 5 Folder
  management): `Share` gains a `failedItems` count (from db/status'
  `pullErrors`/`errors`), rolled up cluster-wide in `clusterHealth()` and
  shown on the Overview's out-of-sync KPI tile and the share detail. The
  folder detail gains an on-demand **Conflicts & failed items** section
  (per the same reasoning as ignore patterns, not part of the model/SSE
  snapshot): new read routes `GET /api/folders/:folderId/failed-items`
  (each sharing node's failed paths + errors, via `/rest/folder/errors`)
  and `GET /api/folders/:folderId/conflicts` (walks each node's
  `/rest/db/browse` tree for `*.sync-conflict-<date>-<time>-*` copies —
  user-triggered only, since it's a full tree walk per node). Syncthing's
  own GUI can't list conflict copies at all, so this is one of the
  cluster-level extras this project exists for.

## [0.4.8]

- **Advanced folder options** (ROADMAP.md Phase 5 Folder management): view and
  edit each node's rescan interval, filesystem-watcher toggle + delay, and
  minimum-free-disk-space threshold for a folder. `Share` gains
  `advanced?: FolderAdvancedOptions` (populated by live aggregation, with
  Syncthing's own defaults filling any field a node omits); new mutation
  route `PUT /api/folders/:folderId/devices/:deviceId/options` (whole-object
  PUT, validated server-side, everything unmodeled preserved via the usual
  GET-modify-PUT). The share detail gains a read-only `Scanning:` summary and
  the folder view's per-node actions gain an Advanced editor. The
  `minDiskFree` unit is kept verbatim on read but restricted to Syncthing's
  known units (`%`, `kB`, `MB`, `GB`, `TB`) on write. Completes the
  "advanced folder options" roadmap item.

## [0.4.7]

- **`sendonly` override + `receiveonly` revert** — confirmation-gated buttons
  on the share detail panel, shown only for the matching folder type. New
  proxy routes `POST /api/folders/:folderId/devices/:deviceId/override` and
  `.../revert` (Syncthing's `/rest/db/override` / `/rest/db/revert`); the
  folder-type check is left to Syncthing, whose error passes through. The
  rest of the "advanced folder options" roadmap item is still open.

## [0.4.6]

- **Copy button next to the device ID** in the detail panel — copies the full
  ID to the clipboard with brief "Copied" feedback. First slice of the
  roadmap's "device identity" item; the QR code view is still open.

## [0.4.5]

Project-wide review pass: bug fixes and documentation refresh, no new features.

- **Fixed: ignore-patterns editor could show — and save — the previous
  folder's patterns after switching folders.** The detail panel's ignore
  section (and each share's action block) wasn't keyed by what it displays,
  so React reused the component instance across folder switches and its
  loaded state carried over; saving would have written folder A's patterns
  under folder B's id. Both are now keyed by folder/share identity so a
  selection change remounts them fresh (regression-tested).
- **Fixed: a stopped/errored folder read as "idle".** `/rest/db/status`
  states `error` and `stopped` (folder-level problems like a missing marker
  or path) now map to the model's `error` state, with db/status' own `error`
  string surfaced as the share's `errorMessage` (previously only per-file
  pull errors from `/rest/folder/errors` counted, so a fully stopped folder
  showed as healthy). Also maps `scan-waiting`/`sync-waiting` to
  scanning/syncing instead of idle.
- **Fixed: clicking a folder edge in the Nodes graph mis-selected the folder
  when its id contains `:`.** The click handler parsed the folder id out of
  the edge's id string; it now travels in the edge's own data.
- **Fixed: duplicate node ids in `cluster.json` were accepted at startup**
  and silently collided in runtime lookups keyed by id — now rejected with a
  clear error, matching the guard runtime registration already had.
- Docs: `CLAUDE.md` no longer claims the repo is greenfield ("no code yet") —
  its current-state, guardrail, dev-data, and definition-of-done sections now
  describe the shipped Phases 1–4 + in-progress Phase 5 reality and defer
  status to `ROADMAP.md`.

## [0.4.4]

- Ignore patterns (ROADMAP.md Phase 5 Folder management): view and edit each
  node's `.stignore` patterns for a folder, with a cluster-level
  "patterns differ / identical across nodes" indicator — the genuinely
  cluster-level bit a single-node GUI can't show. Patterns are fetched
  **on demand** per folder (a "Load ignore patterns" button in the folder
  detail panel), deliberately **not** part of the aggregated `ClusterModel`/SSE
  snapshot: `.stignore` lists are per-node, can be large, and change
  independently of topology. New read route `GET /api/folders/:folderId/ignores`
  (every sharing node's raw patterns, per-node `error` captured rather than
  failing the whole call) and write route
  `PUT /api/folders/:folderId/devices/:deviceId/ignores`. New shared
  on-demand-payload types `FolderIgnores`/`NodeIgnorePatterns`. No auth — same
  trust model as the other mutation routes.

## [0.4.3]

- Folder versioning config (ROADMAP.md Phase 5 Folder management): view and set
  each folder's file-versioning strategy — `none`/`trashcan`/`simple`/
  `staggered`/`external` — per node, since a folder can be versioned differently
  on each node that shares it. `Share` gains `versioning?: FolderVersioning`
  (`{ type, params, cleanupIntervalS? }`), populated first-hand from each node's
  `/rest/config` (`none` is our normalization of Syncthing's own empty-string
  "versioning off"); `params` are Syncthing's raw string knobs kept verbatim.
  New mutation route `PUT /api/folders/:folderId/devices/:deviceId/versioning`,
  a GET-modify-PUT that preserves `fsPath`/`fsType` and other fields we don't
  model. The detail panel's per-share actions gain a Versioning editor (type
  selector + the knob subset Syncthing's own GUI exposes per type; staggered's
  `maxAge` is edited in days and converted to Syncthing's seconds), plus a
  read-only one-line summary. No auth added — same trust model as the other
  mutation routes.

## [0.4.2]

- Transfer totals (ROADMAP.md Phase 5 Observability): cumulative bytes
  in/out, per connection, per device, and cluster-aggregate — the "totals"
  half of "Transfer rates and totals"; live rates are deferred to a follow-up
  (Syncthing's REST API only exposes cumulative counters, not a rate, so
  computing one needs stateful sampling across poll cycles, a bigger
  separate feature). `ClusterModel` gains `connections: Connection[]`
  (`{deviceId, peerId, connected, inBytesTotal, outBytesTotal}`), first-hand
  only like `Share` — a link between two managed nodes gets one row per
  reporting side, summed together (not deduplicated) in the cluster
  aggregate. These totals reset to 0 on disconnect or a restart (Syncthing
  itself only tracks them while a connection is live) — surfaced via a
  tooltip on both new UI pieces: a per-device "Connections" section in the
  detail panel (peer name, connected/disconnected, in/out bytes, plus a
  device-wide total) and a cluster-wide "Data transferred" tile on the
  Overview KPI row.

## [0.4.1]

- Per-node system status (ROADMAP.md Phase 5 Observability): a managed
  device's own version, uptime, memory use, and listener/discovery health
  now show in its detail panel on selection — version and uptime/RAM come
  from `/rest/system/status` (now also fetched: `/rest/system/version`);
  listener/discovery health rolls each up to an "N/M OK" count with the
  actual failures named, matching the existing folder-health "roll up, keep
  detail on selection" convention. Only ever present on a `managed: true`
  device (`Device.systemStatus`) — never derivable for a peer known only via
  another node's config. Read-only; no new mutations or proxy routes.

## [0.4.0]

- Node registration UI (ROADMAP.md Phase 5's last "Foundations" item): register
  and remove Syncthing nodes from the running app instead of hand-editing the
  config file. `dev-cluster.json` is renamed to `cluster.json` and reframed as
  the app's one canonical node registry — it's still read once at startup, but
  now also written back to (atomically, via a temp-file rename) whenever a
  node is registered or removed, so it stays the single source of truth
  either way. New "Register node" dialog (id, URL, API key) and a "Remove
  node" action per node in the Overview's Nodes section, both gated behind
  the same confirmation/preview conventions as every other mutation.
  Registering checks connectivity up front (and rejects a node whose reported
  device ID is already registered under a different id) so a typo'd URL/key
  surfaces as an error instead of silently persisting a node that never
  connects. Removing the very last registered node no longer leaves the
  proxy unable to start back up — an empty node list is now a valid,
  supported state, not a startup error.

## [0.3.2]

- Fixed the share-mode arrowheads and lock badges added in 0.3.1 being hidden
  behind device nodes, exactly where they mattered most: they were drawn as
  raw SVG in the edge's own path at a fixed inset guess (18-34px), nowhere
  near enough to clear a ~120px+ wide device-node pill. Moved them into
  `EdgeLabelRenderer` and now compute the *exact* distance to each device
  node's own rendered boundary (via React Flow's measured node size —
  `useInternalNode`, approximating the pill as its bounding rectangle) so the
  arrow tip lands precisely at the node's edge and the lock sits a bit
  further out toward the middle — both entirely in the open space between
  the two nodes, so the node renders on top as normal without hiding either
  one. Also sized the arrowheads up ~40% and widened the gap between
  parallel lines so the bigger arrowheads don't crowd each other near a
  shared endpoint.
- Fixed that boundary distance being computed from each node's dead center
  and reused as-is for every parallel line a device pair shares — correct
  only for the one line that actually passes through the center. Every other
  line ended up exiting at the same distance along the line regardless of
  its own perpendicular offset, so anything but the innermost arrow floated
  off the node's real (non-circular) edge, "lined up" with the innermost one
  instead of following the boundary. Now computed per line, from its own
  offset starting point.

## [0.3.1]

- Nodes-mode graph: share mode (send/receive/encrypted) is now visible on the
  line itself, not just via the folder-identity color. Each end of a line
  independently gets an arrowhead if that device's own share type receives
  updates (everything except sendonly) — asymmetric shares (one side
  sendonly, the other receiveonly) read correctly since each end only
  depends on its own type. A 🔒 marks whichever end is receiveencrypted, and
  the whole line dashes when either end is. New "Share mode (line)" legend
  section explains the encoding. Extracted the pure graph-layout functions
  (`nodesGraph`/`foldersGraph`) out of `reactFlowAdapter.tsx` into a new
  `graphLayout.ts` (oxlint's react-refresh rule flags a file exporting both
  components and plain functions), making them directly unit-testable.

## [0.3.0]

- Phase 5: **Accept pending devices & folders** — the cluster-wide "inbox".
  `ClusterModel` gains `pendingDevices`/`pendingFolders`, merged across every
  registered node that reports them (the same device trying two nodes, or a
  folder offered on two nodes, shows up once). New proxy routes:
  `POST /api/pending/devices/:deviceId/accept`, `DELETE
  /api/pending/devices/:deviceId`, `POST
  /api/pending/folders/:folderId/devices/:nodeId/accept`, `DELETE
  /api/pending/folders/:folderId/devices/:nodeId`. Accepting a device fans out
  to chosen nodes (reuses `addDevice`); accepting a folder is single-node,
  rejected (400) unless the given `offeredBy` is actually currently offering
  that folder on that node. An offer with `receiveEncrypted: true` locks the
  accepted type to `receiveencrypted` both in the UI and in the API itself.
  New "Pending" section on the Overview page with Accept (opens a dialog) and
  Dismiss (non-permanent) per item.

## [0.2.2]

- Overview: cluster-wide Pause/Resume-all buttons now pick up the app's
  shared button styling (they were missing it entirely — only the color
  modifier classes were scoped to apply outside `.detail-panel`, so they
  rendered as unstyled browser-default buttons) and live in a proper
  "Cluster actions" card instead of a bare row under a heading.
- Overview: new "Nodes" section — a card per device (mirroring the existing
  Folders section, but folder-per-device instead of device-per-folder), with
  a connection-state badge and a clickable row per folder share that jumps
  straight to that share's detail.

## [0.2.1]

- Fixed the graph view unmounting to a blank screen with no visible error on
  a render-time exception (e.g. cluster data that doesn't match an expected
  shape) — the app had no error boundary anywhere, so any thrown error while
  rendering silently blanked the whole page. Added `GraphErrorBoundary`
  around the graph pane: shows the error message and a "Try again" button
  instead.
- Fixed the legend showing every folder-identity and folder-type swatch as
  gray regardless of its actual color. `.legend__swatch` is a height:0 box
  rendered via `border-top` (so dashed vs. solid edges are distinguishable),
  but the color was being set as `backgroundColor` — with zero height that
  never has visible area, so it silently fell back to a default border
  color. Now set as `borderTopColor`.
- The device detail view's folder-shares list is now clickable — selecting a
  row jumps to that share's full detail (stats, completion, and all the
  folder controls), instead of only being reachable via the folder-selection
  view.

## [0.2.0]

- Phase 5: **Per-share encryption passwords** — `POST
  /api/folders/:folderId/devices/:deviceId/shares` accepts an optional
  `encryptionPassword`, making the added (or an already-shared) peer
  untrusted/`receiveencrypted` on its own side. Write-only: never read back
  into the normalized model or any response. An explicit empty string clears
  a previously-set password; omitting the field leaves it as-is. Surfaced as
  an optional password field next to "Add device" in the folder-share panel.
- Phase 5: **Pause all / resume all** — cluster-wide device and folder
  pause/resume (`POST /api/devices/all/pause`, `.../resume`,
  `POST /api/folders/all/pause`, `.../resume`), one refresh for the whole
  batch rather than one per target. A partial failure still applies to and
  refreshes the rest, reported by node→target label (capped at 5 shown).
  Surfaced as a new "Cluster actions" section on the Overview page — the
  first mutation that isn't scoped to a single device or folder.

## [0.1.0]

First versioned snapshot — retroactively covers everything through Phase 4
plus the polish pass that landed alongside the version bump itself, since no
version number existed before this one:

- **Phase 1 — Mockup:** normalized `ClusterModel` shared types, hand-authored
  fixture clusters, graph view, folder-type/device-state visual encoding,
  legend, detail panel.
- **Phase 2 — Live, read-only:** Node/TypeScript proxy aggregating multiple
  Syncthing nodes' own views into one model, served over HTTP + SSE.
- **Phase 3 — Management (first slice):** pause/resume device and folder,
  change folder type, rescan, add/remove a share, create a device/folder
  across chosen nodes — each behind a confirmation or preview.
- **Phase 4 — Views & visual refresh:** Overview and Table views alongside the
  Graph; device/folder shape encoding; the Syncthing-blue logo and accent;
  theme-aware colors; the Nodes/Folders graph-mode toggle with a validated
  categorical palette for folder identity in Nodes mode.
- **Phase 5 (started):** Remove device (fans out to every registered node
  referencing it) and Remove folder (one node only, doesn't touch the data on
  disk).
- Graph modes renamed: the devices-only mesh is **Nodes** (now the default),
  the folder-hub layout is **Folders** (was "Devices only" / "Folders as
  hubs").
- Mesh-mode ("Nodes") fix: selecting a single share now only highlights the
  edges touching that device, not every edge for the folder.
- Proxy: `createFolder` requires 2+ distinct target nodes and de-duplicates
  repeated target ids, matching what the dialog already enforced client-side.
- Proxy: fixed a race where a mutation's own post-write refresh could coalesce
  onto an already-in-flight (pre-mutation) refresh cycle, briefly resolving
  "success" while the model still showed the old state.
- Proxy: unmatched routes are now logged server-side, and connection-level
  fetch failures are normalized instead of potentially leaking internal error
  detail into an HTTP response.
- New `GET /api/version` proxy route; the web build shows its own version next
  to the logo and flags a mismatch against the proxy's.
- CSS pass harmonizing the UI chrome with the actual Syncthing web GUI:
  Raleway headings + its system-font body stack, its literal button palette
  (primary blue, danger red, warning amber) applied to actions, tighter
  Bootstrap-like corner radii, and a panel-heading treatment on cards. The
  data-encoding palette (folder type/state colors) is untouched.
- Docs split into `README.md` (deployment/usage) and `ROADMAP.md` (the phased
  plan, as a checklist).
