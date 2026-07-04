# Roadmap

The plan is phased and each phase is independently shippable. We don't start
management until the visualization reads cleanly, and we don't chase
cluster-wide parity until per-node actions are proven safe.

**Status:** Phases 1–4 are done. Phase 5 (cluster-wide parity with the
Syncthing web GUI) is in progress, worked through in priority order.

Legend: `[x]` shipped · `[ ]` not yet · **(next)** = prioritized for the next
iteration.

---

## Phase 1 — Mockup ✅

A coded, clickable static prototype on **fake data** to settle the visual
language before touching the real API.

- [x] Normalized cluster data model (devices, folders, shares, states) as
      shared TypeScript types.
- [x] Representative fixture clusters (small, large, mixed folder types,
      error/paused, encrypted relay).
- [x] Graph view rendering the fixtures.
- [x] Visual encoding — folder type via color/line-style/arrows; device state;
      rolled-up folder health; legend + detail panel on selection.

**Decisions settled:** graph library is React Flow (`@xyflow/react`), behind a
`GraphAdapter` seam; a folder shared across 3+ devices is drawn as a hyperedge
via a folder-hub node rather than pairwise edges.

## Phase 2 — Visualization (live, read-only) ✅

Real, live cluster state via the proxy. Read-only — no mutations.

- [x] Proxy/backend holds API keys, talks to Syncthing's REST API, exposes the
      normalized model.
- [x] Multi-node aggregation: merge each node's view into one model and
      reconcile disagreements.
- [x] Live updates via the `/rest/events` stream, pushed to the SPA over SSE.
- [x] Health/progress overlays: sync percentage, out-of-sync items, errors.

**Decisions settled:**

- **Proxy runtime:** Node.js + TypeScript, running `.ts` source directly (Node
  24 type-stripping — no bundler/ts-node); shares the model with the frontend
  via the `@clusterfuck/shared` workspace package.
- **Node registration:** a static, untracked JSON config file
  (`packages/proxy/dev-cluster.json`, gitignored), read once at proxy startup.
- **Update strategy:** event-stream-first — long-poll each node's
  `/rest/events` and recompute on relevant events, plus a low-frequency
  (default 45s) full re-poll as a backstop. The SPA gets a full `ClusterModel`
  snapshot over SSE on every change.
- **Aggregation/reconciliation:** per device, an explicit `paused` view from
  any node wins; else `connected` if any node sees a live link; else
  `disconnected`. Folder type/state/completion are known only first-hand from a
  device's own node; a device seen only as a remote peer still appears in the
  graph but gets no `Share` rows.
- **Targets Syncthing 1.x's REST shape** — revisit for 2.x.

## Phase 3 — Management ✅ (first slice)

Make the graph actionable. Per-node first.

- [x] Pause/resume device (fans out to every registered node that peers it).
- [x] Pause/resume folder, change folder type, rescan (edit the owning node's
      config).
- [x] Add/remove a share on a folder.
- [x] Create a device / create a folder (fan-out to selected managed nodes),
      via header dialogs that preview which nodes the change lands on.
- [ ] Accept pending devices/folders (needs a "pending" inbox UI) — see Phase 5.
- [ ] Cluster-wide bulk actions — see Phase 5.

**Decisions settled:**

- **Scope:** per-node/per-folder actions first; cluster-wide actions are a
  separate, later decision.
- **API shape:** mirrors Syncthing's own config/action model
  (`POST /rest/system/pause`, element-scoped `GET`/`PUT
  /rest/config/folders/:id`, `POST /rest/db/scan`, …) rather than inventing
  higher-level operations — keeps the proxy thin and auditable.
- **Safety:** every mutation is behind a confirmation (or a preview dialog for
  creates); fan-out uses `allSettled` and reports exactly which nodes failed.
- **Auth:** none added for mutations — same trust model as the read routes.
  Revisit before exposing beyond localhost (see Phase 5 foundations).

## Phase 4 — Views & visual refresh ✅

Multiple ways to read the same model, plus a design pass.

- [x] **Switchable views** (header tabs), all reading the same `ClusterModel`:
      Graph, Overview (health dashboard — KPI row, worst-first attention list,
      per-folder cards with completion meters, from a tested `clusterHealth()`
      rollup), and Table (every share as a flat, text-only row — the
      dependable fallback channel). Rows in Overview/Table deep-link back into
      the Graph.
- [x] **Shape encoding:** device nodes round, folder hubs square — a second
      channel beyond color, mirrored in the legend.
- [x] **Graph modes:** **Nodes** (default; devices-only mesh — each folder
      becomes pairwise edges colored by folder identity from a validated
      categorical palette; the folders a pair shares render as evenly-offset
      parallel lines so they stay countable) and **Folders** (two-layer
      hyperedge layout; edge color = folder type).
- [x] **Topology editing:** Add device / Add folder dialogs; `Device.managed`
      distinguishes registered nodes from remote-only peers.
- [x] **Visual refresh:** Syncthing-blue logo (favicon + header mark), accent
      color from the same gradient, theme-aware encoding colors (`light-dark()`),
      color-blind-safe folder-type palette validated on both surfaces.

## Phase 5 — Cluster-wide Syncthing GUI parity 🚧

The destination: everything the stock Syncthing web GUI does *for one node*,
done here *for the whole cluster* — one pane of glass instead of N browser
tabs. Mapped from the GUI's actual surface, in priority order.

### Folder management

- [x] Pause/resume, rescan, change type, add/remove share, create shared folder
- [x] Remove folder (per node; cluster-wide removal is doing this on each
      sharing node in turn, no bulk action yet — see Cluster operations)
- [ ] **(next)** Per-share encryption passwords — first-class `receiveencrypted`
      setup, the case this app exists to make legible
- [ ] Versioning config (trashcan/simple/staggered/external) per node
- [ ] Ignore patterns — view/edit per node, diff across nodes
- [ ] Advanced folder options (rescan interval, watcher, min disk free);
      `sendonly` override + `receiveonly` revert
- [ ] Conflict & failed-item surfacing (per folder, cluster-rolled-up)

### Device management

- [x] Pause/resume (fan-out), add device to chosen nodes
- [x] Remove device (fan-out to every registered node referencing it — same
      scope as pause; never from the device's own config)
- [ ] **(next)** Accept pending devices & folders — the cluster-wide "inbox"
      (Syncthing's pending API), so introducing a node becomes: accept once,
      everywhere
- [ ] Edit device options: name, addresses, compression, introducer,
      auto-accept, per-device rate limits
- [ ] Device identity: show ID/QR for any managed node

### Cluster operations

- [ ] **(next)** Pause all / resume all (devices or folders)
- [ ] Rescan all; restart/shutdown a node's Syncthing; upgrade orchestration
      (one node at a time, health-checked)
- [ ] Config drift detection: same folder configured differently across nodes
      (label/type/versioning mismatches), asymmetric shares (A shares with B,
      B doesn't share back), with suggested fixes — the genuinely novel
      cluster-level feature a single-node GUI cannot have
- [ ] Bandwidth limits cluster-wide

### Observability

- [x] Live state/completion/errors via events + SSE; overview dashboard
- [ ] Per-node system status (version, uptime, listeners, discovery, RAM/CPU)
- [ ] Transfer rates and totals (per link, per node, cluster aggregate)
- [ ] Recent-changes feed and event log, merged across nodes
- [ ] Completion history/sparklines on the overview tiles

### Foundations these need

- [ ] **(next)** Node registration UI (add a node's URL + API key at runtime,
      persisted server-side) — replaces editing `dev-cluster.json` by hand
- [ ] Auth on the proxy the moment it's exposed beyond localhost
- [ ] Syncthing 2.x REST support (currently targets 1.x)
