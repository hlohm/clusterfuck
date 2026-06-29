# clusterfuck

A visualization and management app for [Syncthing](https://syncthing.net/) clusters.

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
| Graph library | TBD | Chosen in the visualization phase (D3 / Cytoscape / React Flow candidates) |
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
- **Open decisions to settle here:** proxy implementation language/runtime;
  how the user registers nodes and supplies API keys; how aggressively to poll
  vs. rely on the event stream.

### Phase 3 — Management

Make the graph actionable. Per-node first, then cluster-wide.

- **Per-node / per-folder:** pause/resume device or folder; change folder type;
  add/remove a share; rescan; accept pending devices/folders.
- **Cluster-wide (to be designed):** candidate ideas — pause-all / resume-all;
  introduce a new device to a whole folder group at once; bulk folder-type
  changes; apply a "policy" (e.g. mark a node receive-encrypted everywhere);
  templated folder defaults. We'll decide which of these are genuinely useful
  vs. footguns.
- Safety: confirmations, dry-run/preview of what a bulk action will change,
  and clear surfacing of partial failures across nodes.
- **Open decisions to settle here:** which cluster-wide actions ship (if any);
  how much we mirror Syncthing's own config model vs. impose our own
  higher-level concepts; auth/permissions if this is ever multi-user.

## Status

Phase 0: just getting started. This commit is the outline only — no code yet.
Major decisions will be raised as we hit them rather than guessed up front.
