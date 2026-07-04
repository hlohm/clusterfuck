# <img src="packages/web/public/logo.svg" width="34" alt="clusterfuck logo — three interwoven Syncthing-style node glyphs"> clusterfuck

A visualization and management app for [Syncthing](https://syncthing.net/) clusters.

The mark is three interwoven Syncthing-style hub-and-spoke glyphs sharing one
ring, in Syncthing's own blue — one cluster, many overlapping views of it. It
doubles as the app's favicon and header logo, and the app's accent color is
drawn from the same gradient.

Syncthing's built-in UI shows folders and devices as flat lists. Once you run
more than a handful of nodes, it gets hard to reason about the *topology* of
your cluster: who shares what with whom, which links are send-only vs.
receive-only, where encrypted relays sit, and which folders are paused or out of
sync. **clusterfuck** renders the whole cluster as a graph so the shape of your
sync setup — and its important options — is visible at a glance, and lets you
manage nodes (and eventually the cluster as a whole) from one place.

## Goals

- **Visualize the cluster as a graph.** Nodes are Syncthing devices, edges are
  shared folders. Layout makes the topology legible at a glance.
- **Surface sync semantics visually.** Folder type (send/receive, send only,
  receive only, receive encrypted) and device/folder state (paused, syncing,
  up to date, error) should be readable from the graph without drilling in.
- **Manage nodes and the cluster.** Per-node actions are the obvious starting
  point (pause/resume, edit folder type, add/remove shares). Cluster-wide
  actions are an open design question we'll work out (see Roadmap §3).

## Tech decisions (so far)

| Decision | Choice | Notes |
|---|---|---|
| Platform | Web app (React + TypeScript) | SPA; deployable anywhere |
| Data source | Syncthing REST API | Live cluster state via REST + `/rest/events` stream |
| Graph library | React Flow (`@xyflow/react`) | Isolated behind a `GraphAdapter` interface for swappability |
| 3+ device folder shares | Hyperedge via a folder-hub node | Rather than pairwise edges between every device pair |
| Proxy runtime | Node.js + TypeScript | Shares the normalized model with the frontend as one `@clusterfuck/shared` workspace package |
| Node registration | Static, untracked config file | Read once at proxy startup; see Phase 2 below |
| Views | Graph, Overview, Table — switchable | Graph is the home view; Overview is the health dashboard; Table is the flat fallback channel |
| First deliverable | Coded static prototype | Clickable React mockup on fake data, then wire to the real API |

### Connecting to Syncthing

Syncthing exposes a [REST API](https://docs.syncthing.net/dev/rest.html)
(authenticated by an `X-API-Key` header) and a long-polling event stream at
`/rest/events`. A browser SPA can't talk to it directly because of CORS and
key handling, so the architecture assumes a thin proxy/backend between the SPA
and each Syncthing instance. The proxy holds the API keys, fans out to one or
more Syncthing nodes, and exposes a normalized cluster model to the frontend.
(Proxy implementation language is an open decision — see Roadmap §2.)

## Roadmap

The plan is three phases, each independently shippable. We do not start
management until the visualization reads cleanly.

### Phase 1 — Mockup

A coded, clickable static prototype on **fake data** so we can settle the visual
language before touching the real API.

- Define the normalized cluster data model (devices, folders, shares, states).
- Hand-author a few representative fixture clusters (small, large, mixed folder
  types, error/paused states).
- Build the graph view rendering those fixtures.
- Design the visual encoding:
  - **Edges** = shared folders; encode folder type — send/receive, send only,
    receive only, receive encrypted — via direction/arrowheads, color, or
    line style.
  - **Nodes** = devices; encode state (this node / paused / connected /
    disconnected) and roll up folder health.
  - Legend + node/edge detail panel on selection.
- **Open decisions to settle here:** graph library choice; the exact visual
  encoding for the four folder types; how to show a folder shared across 3+
  devices (one hyperedge vs. pairwise edges).

### Phase 2 — Visualization (live, read-only)

Replace fixtures with real, live cluster state. Read-only — no mutations yet.

- Stand up the proxy/backend that holds API keys and talks to Syncthing's REST
  API; expose the normalized model to the frontend.
- Multi-node aggregation: merge each node's view into one cluster model and
  reconcile disagreements (e.g. connection state seen from both ends).
- Live updates via the `/rest/events` stream (completion, state changes,
  connect/disconnect).
- Health/progress overlays: sync percentage, out-of-sync items, errors.
- **Decisions made:**
  - **Proxy runtime:** Node.js + TypeScript. Runs the `.ts` source directly
    (Node 24's native type-stripping — no bundler/ts-node step); shares the
    normalized model with the frontend via an npm-workspaces package
    (`@clusterfuck/shared`) instead of duplicating or code-generating types.
  - **Node registration:** a static, untracked JSON config file
    (`packages/proxy/dev-cluster.json`, gitignored; see
    `dev-cluster.example.json` for the shape), read once at proxy startup.
    Matches the existing fixture-cluster convention. An in-app "add node" UI
    with persistent storage is deferred to Phase 3, since it's a mutable-state
    concern that doesn't belong in a read-only phase.
  - **Update strategy:** event-stream-first. The proxy long-polls each node's
    `/rest/events` and recomputes on relevant events, plus a low-frequency
    (default 45s) full re-poll as a backstop against a missed event or a
    silently dropped connection. The frontend gets updates via a Server-Sent
    Events endpoint (`/api/events`) that pushes a full `ClusterModel` snapshot
    on every change.
  - **Aggregation/reconciliation policy:** per device, an explicit `paused`
    view from any node wins; else `connected` if any node currently sees a
    live link; else `disconnected`. Folder type/state/completion are only
    known first-hand from a device's own node — a device visible only as a
    remote peer in another node's config still appears in the graph (for
    topology completeness) but gets no `Share` rows.
  - **Targets Syncthing 1.x's REST shape** (per the sample `/rest/system/status`
    response used to validate this) — revisit if the deployed cluster turns
    out to be 2.x.

### Phase 3 — Management

Make the graph actionable. Per-node first, then cluster-wide.

- **Per-node / per-folder (first slice):** pause/resume device; pause/resume
  folder; change folder type; add/remove a share; rescan.
  - **Device pause/resume** fans out to every registered node whose own config
    lists that device as a peer, and pauses/resumes *that connection* — same
    as clicking pause in that node's own Syncthing GUI. This works even for a
    device we don't hold API keys for ourselves, as long as some registered
    node has a connection to it; if no registered node references it at all,
    the action has no valid target and fails.
  - **Folder-scoped actions** (pause/resume folder, change type, add/remove
    share, rescan) always edit one specific registered node's own folder
    config — the node identified by the Share's `deviceId`, which by
    construction of the aggregation is always one of our own registered
    nodes (Phase 2 only ever produces Share rows from a node's first-hand
    view of its own folders).
- **Deferred to a later slice:** accept pending devices/folders (needs new
  "pending" UI, not just mutation plumbing); cluster-wide actions (pause-all /
  resume-all, bulk folder-type changes, policy application, templated folder
  defaults, introducing a device to a whole folder group at once) — candidate
  ideas, to be designed once single-node mutations are proven safe.
- Safety: confirmations, dry-run/preview of what a bulk action will change,
  and clear surfacing of partial failures across nodes (relevant once
  cluster-wide actions exist).
- **Decisions made:**
  - **Scope:** per-node/per-folder actions first; cluster-wide actions are a
    separate, later decision.
  - **API shape:** mirrors Syncthing's own config/action model closely (e.g.
    `POST /rest/system/pause?device=`, element-scoped `GET`/`PUT
    /rest/config/folders/:id`, `POST /rest/db/scan`) rather than inventing
    clusterfuck-native higher-level operations. Keeps the proxy thin and the
    mutation surface auditable.
  - **Auth/permissions:** none added for mutations specifically — same trust
    model as Phase 2 (the proxy holds the keys; anyone who can reach the proxy
    can already read everything). Revisit if this ever becomes multi-user or
    is exposed beyond localhost.

### Phase 4 — Views & visual refresh

Multiple ways of reading the same cluster model, plus a design pass.

- **Switchable views**, tabs in the header, all reading the same normalized
  `ClusterModel`:
  - **Graph** — the topology canvas from Phases 1–3 (home view; keeps the
    detail panel, legend, and Phase 3 actions).
  - **Overview** — the health dashboard: a KPI row (devices online, folders up
    to date, out-of-sync items, needs-attention count), a worst-first
    "needs attention" list, and a card per folder with per-device state and
    sync-completion meters. Backed by a pure, tested `clusterHealth()` rollup
    in `@clusterfuck/shared`.
  - **Table** — every share as a flat row with type/state/completion/errors
    spelled out as text; the dependable fallback channel for everything the
    graph encodes with color and shape.
  - Rows in Overview/Table link back to the Graph with that share selected.
- **Shape encoding:** device nodes are round (pills), folder hubs are square —
  a second visual channel for the device/folder distinction beyond position
  and color, mirrored in the legend.
- **Visual refresh:** the logo is three interwoven Syncthing-style
  hub-and-spoke glyphs on Syncthing's own blue gradient
  (`packages/web/public/logo.svg`, also the favicon and header mark), the
  app's accent color is drawn from that gradient, and the encoding colors are
  now theme-aware (CSS `light-dark()`) in both modes. The folder-type palette
  re-validated for color-blind-safe separation and contrast on both surfaces.
- **Graph modes** (added in the follow-up iteration): the graph toggles
  between *Folders as hubs* (the two-layer hyperedge layout; edge color =
  folder type) and *Devices only* — a nodes-only mesh where each folder
  becomes pairwise edges between the devices sharing it, colored by folder
  identity from a validated categorical palette (8 slots; past 8 the tail
  goes neutral and the legend/table carry identity). Devices sit on a circle;
  parallel edges between a pair fan out with different curvatures.
- **Topology editing** (same iteration): *Add device* (register a peer on any
  subset of managed nodes) and *Add folder* (create a folder on ≥2 managed
  nodes, shared among them) via header dialogs that preview exactly which
  nodes the change lands on. The model gained `Device.managed` to distinguish
  our registered nodes from devices only seen as remote peers.

### Phase 5 — Cluster-wide Syncthing GUI parity (roadmap)

The destination: everything the stock Syncthing web GUI can do *for one
node*, doable here *for the whole cluster* — one pane of glass instead of N
browser tabs. Mapped from the GUI's actual surface, in rough priority order.
`✔` = already shipped, `→` = next up, `·` = later.

**Folder management**
- ✔ Pause/resume, rescan, change type, add/remove share, create shared folder
- → Remove folder (per node / cluster-wide)
- → Per-share encryption passwords — first-class `receiveencrypted` setup,
  the case this app exists to make legible
- · Versioning config (trashcan/simple/staggered/external) per node
- · Ignore patterns — view/edit per node, diff across nodes
- · Advanced folder options (rescan interval, watcher, min disk free);
  `sendonly` override + `receiveonly` revert buttons
- · Conflict & failed-item surfacing (per folder, cluster-rolled-up)

**Device management**
- ✔ Pause/resume (fan-out), add device to chosen nodes
- → Remove device (from chosen/all nodes)
- → Accept pending devices & folders — the cluster-wide "inbox" (Syncthing's
  pending API), so introducing a node becomes: accept once, everywhere
- · Edit device options: name, addresses, compression, introducer,
  auto-accept, per-device rate limits
- · Device identity: show ID/QR for any managed node

**Cluster operations**
- → Pause all / resume all (devices or folders)
- · Rescan all; restart/shutdown a node's Syncthing; upgrade orchestration
  (one node at a time, health-checked)
- · Config drift detection: same folder configured differently across nodes
  (label/type/versioning mismatches), asymmetric shares (A shares with B,
  B doesn't share back), with suggested fixes — the genuinely novel
  cluster-level feature the single-node GUI cannot have
- · Bandwidth limits cluster-wide

**Observability**
- ✔ Live state/completion/errors via events + SSE; overview dashboard
- · Per-node system status (version, uptime, listeners, discovery, RAM/CPU)
- · Transfer rates and totals (per link, per node, cluster aggregate)
- · Recent-changes feed and event log, merged across nodes
- · Completion history/sparklines on the overview tiles

**Foundations these need**
- → Node registration UI (add a node's URL + API key at runtime, persisted
  server-side) — replaces editing `dev-cluster.json` by hand
- · Auth on the proxy the moment it's exposed beyond localhost
- · Syncthing 2.x REST support (currently targets 1.x)

## Status

Phases 1–4 are implemented: fixture mockup, live read-only visualization via
the proxy, per-node/per-folder management actions (including creating devices
and folders), and the multi-view UI — graph (hub and mesh modes), overview
dashboard, and table — with the visual refresh. Phase 5 is the roadmap above:
full cluster-wide parity with the Syncthing web GUI, worked through in
priority order. Major decisions continue to be raised as they come up rather
than guessed up front.
