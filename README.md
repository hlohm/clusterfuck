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
    out-of-sync items, a worst-first "needs attention" list, and per-folder
    cards with completion meters.
  - **Table** — every share as a flat, text-only row (the accessible fallback).
- **Live, read-only cluster state** aggregated from every node and pushed to the
  browser over Server-Sent Events.
- **Management actions** (against a live cluster): pause/resume devices and
  folders, change folder type, set file-versioning (trashcan/simple/staggered/
  external) per node, rescan, add/remove shares, and create new devices and
  folders across a chosen set of nodes — each behind a confirmation or preview.

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
  mutation routes). See [`packages/proxy/README.md`](packages/proxy/README.md)
  for the full route list.
- **`packages/web`** is the React + TypeScript SPA (Vite, React Flow).
- **`packages/shared`** (`@clusterfuck/shared`) is the normalized `ClusterModel`
  and its pure logic — the one contract both sides import, so types never drift.

It's a pnpm workspace monorepo; the proxy runs its `.ts` source directly via
Node's native type-stripping (no build step).

## Requirements

- **Node.js 24+** (the proxy relies on native TypeScript stripping)
- **pnpm** (`corepack enable`, or install per pnpm's docs — the repo pins a
  version via `packageManager`)
- One or more reachable **Syncthing 1.x** nodes, each with its REST API key

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

**2. Web** — build the static bundle and serve it from any static host/CDN:

```sh
pnpm --filter @clusterfuck/web build   # -> packages/web/dist
```

The SPA reaches the proxy via **relative `/api/*`** paths by default, so the
simplest deployment puts the static files and the proxy behind one origin with
a reverse proxy routing `/api/*` to the proxy (and everything else to the
static files). If instead the SPA is served from a different origin than the
proxy, build with `VITE_PROXY_URL` set to the proxy's base URL and set
`CLUSTERFUCK_WEB_ORIGIN` on the proxy to the SPA's origin:

```sh
VITE_PROXY_URL=https://proxy.example pnpm --filter @clusterfuck/web build
```

> **Security:** the proxy holds your Syncthing API keys and has **no
> authentication** — anyone who can reach it can read cluster state and perform
> management actions. Only expose it on a trusted network or behind your own
> auth (e.g. an authenticating reverse proxy). Proxy auth is a tracked roadmap
> item. `cluster.json`, `.env.local`, and `*.local.md` are gitignored; never
> commit real endpoints or keys.

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
