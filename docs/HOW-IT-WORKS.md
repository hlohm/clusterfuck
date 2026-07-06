# How clusterfuck works

A tour of the architecture for a reader who knows their way around IT —
networks, servers, APIs as concepts — but doesn't write code. The README says
*what* we're building and why; this explains *how the pieces fit*.

## The problem being solved

Syncthing is deliberately peer-to-peer: there is no central server. Every
machine runs its own Syncthing service with its own config file, its own list
of peers ("devices") and shared folders, and its own admin web GUI on port
8384. The "cluster" is never stored anywhere as a whole — it only exists
implicitly, as the overlap of all those per-node configs.

That's great for resilience and terrible for legibility. With more than a
few nodes, answering "what's shared with what, in which direction, and is it
healthy?" means opening N browser tabs and cross-referencing them by hand.
clusterfuck gives you the missing single pane of glass: the whole cluster
drawn as a graph — machines as nodes, shared folders as the lines between
them — plus the ability to manage it from one place.

## The three parts

The repo is a *monorepo*: one repository containing three packages that are
built and versioned together (one version number for the whole app).

```
Syncthing node A ─┐  (REST API, key A)
Syncthing node B ─┼──►  proxy  ──►  normalized model  ──►  web (browser)
Syncthing node C ─┘   (backend)      (shared)               (frontend)
```

### `packages/shared` — the common language

A library both other parts use. Its centerpiece is the **normalized cluster
model**: a single, precisely-typed data structure describing an entire
cluster — the devices, the folders, the *shares* (a folder as configured on
one particular device, including its type: two-way, send-only, receive-only,
or encrypted-untrusted), the connections between devices, and any pending
invitations. Plus pure logic that operates on that structure (validation,
health roll-ups).

This model is the contract of the whole system: the proxy's job is to
*produce* it, the web app's job is to *render* it, and the hand-written demo
clusters ("fixtures") conform to it. Nothing else crosses the boundary.

### `packages/proxy` — the backend

A small Node.js web server that runs next to the cluster (in your case, in
the VM on the lab server). It's the only component that ever talks to
Syncthing, and it has two jobs: **collect** and **relay**.

**Why it must exist at all.** Each Syncthing's REST API is guarded by an API
key — an admin credential sent as a header with every request. Shipping
those keys to a browser would expose them to anyone who can open dev tools,
and browsers' cross-origin rules (CORS) would block the requests anyway. So
the keys live server-side, in a git-ignored `cluster.json` (one entry per
node: URL + API key), and the browser only ever talks to the proxy.

**Collecting.** For every registered node, the proxy calls a handful of that
node's REST endpoints: who am I (`/rest/system/status`), what's my config —
devices, folders, who shares what (`/rest/config`), who am I connected to
(`/rest/system/connections`), how synced is each folder
(`/rest/db/status`, `/rest/db/completion`), any errors, and any pending
invitations. That yields one **snapshot per node** — that node's personal
worldview.

Then comes the interesting part: **aggregation**. Each node only knows its
own view, and views disagree — node A may say it's connected to B while B
disagrees, and each end reports its own completion percentage. The
aggregator merges all snapshots into the one normalized model, reconciling
those conflicts, so the UI can show a single coherent cluster.

**Staying live.** Rather than hammering every node with polls, the proxy
*long-polls* each node's `/rest/events` stream — a request that Syncthing
holds open until something happens (a folder changes state, a device
connects…). Relevant events trigger a refresh of the model; a slow
background re-poll acts as a safety net in case an event is missed. Updated
models are pushed to every open browser tab over **SSE** (server-sent
events — a one-way streaming HTTP connection), so the graph updates without
reloading.

**Relaying commands.** The proxy also exposes its own small HTTP API under
`/api/...` — this is what the browser calls. Read routes serve the model;
mutation routes each map to the matching Syncthing operation on the right
node. Your intuition was exactly right: it's route-per-operation. For
example:

- `POST /api/folders/{folder}/devices/{device}/rescan` → the proxy looks up
  which registered node has that device ID and calls *that node's*
  `/rest/db/scan`.
- Changing a folder's type or versioning settings → fetch that node's config
  for the folder, modify it, `PUT` it back — the same thing the node's own
  GUI does.
- Cluster-wide actions (pause a device everywhere, remove a device) **fan
  out**: the same call is sent to every relevant node in parallel, partial
  failures are tolerated, and the response names exactly which nodes failed.

Mutations are queued one-at-a-time (no two config edits racing each other),
and each is followed by a refresh so the UI reflects reality quickly. The
proxy never invents higher-level operations — every button corresponds to
something Syncthing itself can do, which keeps behavior predictable.

### `packages/web` — the frontend

A React single-page app: the server hands the browser one bundle of
JavaScript, and from then on everything is rendered client-side from the
model. It offers:

- **Graph view** — devices as nodes, folders as edges (drawn with the React
  Flow library). The four folder types are visually distinct — including the
  encrypted-untrusted case most tools fumble — and device/folder health is
  rolled up onto the nodes.
- **Overview dashboard and table view** — cluster KPIs, out-of-sync counts,
  transfer totals, the pending-invitations "inbox".
- **Detail panel** — click a device, folder, or share and get its state plus
  the management actions. *Every* action that changes anything sits behind a
  confirmation dialog.
- **Source dropdown** — instead of the live proxy you can load a *fixture*:
  a hand-authored fake cluster covering every state the model can express
  (all four folder types, errors, paused things, encrypted peers, pending
  offers). That's what makes the UI explorable and testable with no real
  cluster attached.

## One click, end to end

You click **Pause folder** on node X and confirm:

1. The browser sends `POST /api/folders/{folder}/devices/X/pause` — to the
   proxy, never to Syncthing.
2. The proxy finds node X's entry in its registry and updates that folder's
   config on X's Syncthing, authenticated with X's API key.
3. X's Syncthing pauses the folder and emits an event; the proxy's
   long-poll picks it up and re-assembles the model.
4. The new model streams to every open browser over SSE, and the edge in
   your graph turns to its "paused" style.

At no point did the browser hold a key or touch a Syncthing directly.

## Things worth knowing before exposing it

- **The proxy has no login yet.** Anyone who can reach its port can read
  *and manage* the cluster. Keep it on a trusted network / behind your own
  reverse-proxy auth; proper auth is a roadmap prerequisite for 1.0.
- **One version number everywhere.** The web UI shows its version and the
  proxy reports its own at `/api/version`; the header compares them. A
  mismatch almost always means a stale proxy process is still running.
- **`cluster.json` is the only secret-bearing file.** It's git-ignored,
  written by the proxy itself when you register/remove nodes in the UI, and
  its contents never appear in any HTTP response.

## Multi-cluster: today and someday

Nothing in the *model* assumes a single cluster — it already carries a
cluster ID and label. But the running system is one-cluster-per-process:
one proxy process reads one `cluster.json`, owns one live model, and the
web app talks to one proxy (same-origin by default, overridable with the
`VITE_PROXY_URL` build setting).

**Today**, you can absolutely manage two clusters: run two proxy instances
on different ports, each with its own `cluster.json`, and open two browser
tabs. Clunky but fully functional, since nothing is shared between
instances.

**As a feature**, folding it in means: the proxy holds several named
registries (one manager per cluster) with its API namespaced per cluster
(`/api/clusters/{id}/...`), and the web app grows a cluster switcher next
to the existing fixture picker. The model seam is ready for it; the work is
mostly mechanical route/UI plumbing — a proper milestone, tracked at the
bottom of `ROADMAP.md`.
