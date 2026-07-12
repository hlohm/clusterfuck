# <img src="packages/web/public/logo.svg" width="34" alt="clusterfuck logo — three interwoven Syncthing-style node glyphs"> clusterfuck

A visualization and management app for [Syncthing](https://syncthing.net/)
clusters — the whole cluster in one pane of glass instead of N browser tabs.

Syncthing's built-in UI shows one node's folders and devices as flat lists.
Once you run more than a handful of nodes it gets hard to reason about the
*topology*: who shares what with whom, which links are send-only vs.
receive-only, where encrypted relays sit, which folders are paused or out of
sync. **clusterfuck** renders the whole cluster as a graph so the shape of your
sync setup — and its important options — is legible at a glance, and lets you
manage devices and folders across every node from one place.

> ⚠️ **100% vibe coded by an amateur, use at your own peril!** This is a
> hobby project built fast with an AI coding agent. It talks to your
> Syncthing nodes' REST APIs and can mutate their config. Read the security
> note below, keep backups, and don't point it at anything you can't afford
> to break.

## What it does today

- **Three views** of the live cluster, switchable from the header:
  - **Graph** — the topology, with two layouts: **Nodes** (default; a mesh of
    devices only, with parallel folder-colored edges between the devices that
    share each folder) and **Folders** (folder-hub nodes with folder-type-
    colored edges to their devices). Devices are round, folder hubs are square.
  - **Overview** — a health dashboard: devices online, folders up to date,
    out-of-sync items, a worst-first "needs attention" list, a **config
    drift** section (same folder labeled/versioned differently across nodes,
    asymmetric shares, all-sendonly/all-receiveonly folders — each with a
    suggested fix; the cluster-level check a single-node GUI can't do), and
    per-folder cards with completion meters.
  - **Table** — every share as a flat, text-only row (the accessible fallback).
- **Live, read-only cluster state** aggregated from every node and pushed to the
  browser over Server-Sent Events.
- **Management actions** (against a live cluster): pause/resume devices and
  folders, change folder type and label, set file-versioning (trashcan/simple/
  staggered/external), advanced folder options (rescan interval, watcher, min
  disk free) and ignore patterns per node (with a diff-across-nodes
  indicator), rescan, add/remove shares (with per-share encryption passwords),
  edit device options (addresses, compression, introducer, auto-accept,
  per-device rate limits) across every referencing node, and create new
  devices and folders across a chosen set of nodes — each behind a
  confirmation or preview.
- **Cluster operations:** pause/resume/rescan everything in one action,
  restart or shut down a node's Syncthing, node-global bandwidth caps
  (per node or all nodes), and health-checked upgrade orchestration — every
  node, strictly one at a time, aborting if a node doesn't come back.
- **Observability:** live transfer rates per link (estimated from Syncthing's
  cumulative counters), per-share completion sparklines, a cluster-merged
  recent-changes feed, a filterable raw event log, per-node system status,
  and a device-ID QR relayed from Syncthing's own renderer.

See **[ROADMAP.md](ROADMAP.md)** for what's shipped and what's planned (the goal
is cluster-wide parity with the Syncthing web GUI).

## Architecture

A browser SPA can't talk to Syncthing directly (CORS, and it must not hold API
keys), so there's a thin proxy between them:

```
 Browser SPA  ──/api/*──►  proxy (Node/TS)  ──X-API-Key──►  Syncthing node A
 (packages/web)            (packages/proxy)             ├─►  Syncthing node B
                                                        └─►  …
```

- **`packages/proxy`** holds the API keys, polls each node's REST API plus its
  `/rest/events` stream, aggregates the per-node views into one normalized
  cluster model, and serves it read-only over HTTP + SSE (plus the Phase 3
  mutation routes). Auth is opt-in — turn it on from the app (Settings ⚙ →
  Generate & enable) or by setting `CLUSTERFUCK_TOKEN`: a shared token,
  entered once per browser (cookie thereafter) or sent as a Bearer header by
  scripts. With the web app built, the proxy serves it too — production is
  one process on one origin. See
  [`packages/proxy/README.md`](packages/proxy/README.md) for the full route
  list and auth details.
- **`packages/web`** is the React + TypeScript SPA (Vite, React Flow).
- **`packages/shared`** (`@clusterfuck/shared`) is the normalized `ClusterModel`
  and its pure logic — the one contract both sides import, so types never drift.

It's a pnpm workspace monorepo; the proxy runs its `.ts` source directly via
Node's native type-stripping (no build step).

## Requirements

- **Node.js 24+** (the proxy relies on native TypeScript stripping)
- **pnpm** (`corepack enable`, or install per pnpm's docs — the repo pins a
  version via `packageManager`)
- One or more reachable **Syncthing 1.x or 2.x** nodes, each with its REST
  API key — mixed-major clusters (normal mid-migration) are supported: the
  proxy adapts per node, the UI shows each node's version and flags the mix,
  and the cluster upgrade sweep never crosses a major version without an
  explicit, separately-confirmed opt-in

## Quick start (local)

```sh
pnpm install

# Tell the proxy which nodes to talk to (untracked; never commit real keys)
cp packages/proxy/cluster.example.json packages/proxy/cluster.json
# edit it: each node's id, base URL, and X-API-Key
```

`cluster.json` looks like:

```json
{
  "nodes": [
    { "id": "st-a", "url": "http://127.0.0.1:18384", "apiKey": "…" },
    { "id": "st-b", "url": "http://127.0.0.1:28384", "apiKey": "…" }
  ]
}
```

(An API key is under **Actions → Settings → GUI** in each node's Syncthing UI.)
This is only needed to get the first node or two registered — once the proxy
is running, you can register and remove nodes from the app itself (**Register
node** / **Remove node**), which keeps `cluster.json` in sync automatically.

Then run both halves together:

```sh
pnpm dev
```

- Web dev server: **http://localhost:5173** — open this.
- Proxy: **http://localhost:4000**. In dev, Vite forwards `/api/*` to it, so
  there's no CORS to configure.

Pick **"Live cluster (proxy)"** from the Source dropdown to see your real
cluster; the other sources are built-in fixtures for exploring the UI without a
live cluster. Run just one side with `pnpm dev:web` or `pnpm dev:proxy`.

## Deployment

The two halves deploy independently: a static site and a long-running Node
service.

**1. Proxy** — run it wherever it can reach your Syncthing nodes:

```sh
CLUSTERFUCK_CONFIG=/etc/clusterfuck/nodes.json \
PORT=4000 \
CLUSTERFUCK_WEB_ORIGIN=https://clusterfuck.example \
pnpm --filter @clusterfuck/proxy start
```

Proxy environment variables:

| Var | Default | Purpose |
|---|---|---|
| `PORT` | `4000` | HTTP port |
| `CLUSTERFUCK_CONFIG` | `./cluster.json` | Path to the nodes config (relative to cwd) — the proxy also writes to this file when nodes are registered/removed at runtime |
| `CLUSTERFUCK_WEB_ORIGIN` | `http://localhost:5173` | CORS allow-origin — the URL the SPA is served from (only needed when the SPA calls the proxy cross-origin) |

**2. Web** — build the static bundle:

```sh
pnpm --filter @clusterfuck/web build   # -> packages/web/dist
```

The **simplest deployment is one process**: the proxy serves the built web
app itself (it picks up `packages/web/dist` automatically, or
`CLUSTERFUCK_WEB_DIST`), so the SPA and the API share one origin and nothing
else needs configuring. Alternatively serve `dist/` from any static
host/CDN — the SPA reaches the proxy via relative `/api/*` paths, so either
put both behind one reverse-proxied origin, or build with `VITE_PROXY_URL`
set to the proxy's base URL and set `CLUSTERFUCK_WEB_ORIGIN` on the proxy to
the SPA's exact origin (never `*` — cookies don't work with wildcards):

```sh
VITE_PROXY_URL=https://proxy.example pnpm --filter @clusterfuck/web build
```

> **Security:** the proxy holds your Syncthing API keys, and its API can
> read and mutate every registered node. **Auth is opt-in:** turn it on from
> the app (Settings ⚙ → **Generate & enable**, which stores a token in a
> gitignored `auth.json`) or by setting `CLUSTERFUCK_TOKEN` to a long random
> string; then every request requires the token — browsers sign in once per
> device (cookie thereafter), scripts send it as an `Authorization: Bearer`
> header. The env var, when set, is authoritative and the GUI defers to it.
> See
> [docs/HOW-AUTH-WORKS.md](docs/HOW-AUTH-WORKS.md) for how it works and its
> limits. Without the token the proxy is **open** (it warns at startup) —
> never expose that beyond a trusted network. The proxy speaks plain HTTP
> either way; put HTTPS (reverse proxy, VPN) in front before crossing
> untrusted networks. `cluster.json`, `.env.local`, and `*.local.md` are
> gitignored; never commit real endpoints or keys.

## Development

Scripts run across all workspace packages from the repo root:

| Command | What it does |
|---|---|
| `pnpm dev` | Run web + proxy together (watch mode) |
| `pnpm dev:web` / `pnpm dev:proxy` | Run one side |
| `pnpm typecheck` | `tsc` across packages |
| `pnpm lint` | oxlint |
| `pnpm test` | vitest across packages |
| `pnpm build` | Production build |

Green before commit: typecheck, lint, test, and build must all pass. `main` is
protected — land changes via small, topic-branch PRs. Contributor conventions
and architecture guardrails live in `CLAUDE.md`.

## Project layout

```
packages/
  shared/   @clusterfuck/shared — normalized ClusterModel + pure logic
  proxy/    Node/TS backend: REST client, aggregation, HTTP + SSE, mutations
  web/      React + TypeScript SPA (Vite, React Flow)
ROADMAP.md   phased plan; what's done and what's next
CHANGELOG.md dated, version-by-version log (see CLAUDE.md for the versioning policy)
CLAUDE.md    working context / conventions for contributors
```

The running proxy and the web build each know their own version —
`GET /api/version` on the proxy, shown next to the logo in the header — so a
stale proxy process (the usual cause of a route the frontend expects
returning a bare 404) is a glance away from a mismatch warning instead of a
mystery.
