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
  (`packages/proxy/cluster.json`, gitignored), read once at proxy startup —
  extended in Phase 5 with a runtime registration UI that also writes back to
  this same file, so it's stayed the one canonical registry rather than
  splitting into a separate runtime store.
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
- [x] Accept pending devices/folders — shipped in Phase 5, see below.
- [x] Cluster-wide bulk actions — shipped in Phase 5, see below.

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
      parallel lines so they stay countable; each end independently gets an
      arrowhead if that device's own share type receives updates, a 🔒 +
      whole-line dash if either end is receiveencrypted — asymmetric shares
      read correctly since each end only depends on its own type) and
      **Folders** (two-layer hyperedge layout; edge color = folder type).
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
- [x] Per-share encryption passwords — setting one on an added/existing share
      makes that peer untrusted/`receiveencrypted` on its own side; write-only,
      never read back into the model; an empty string explicitly clears it
- [x] Versioning config (trashcan/simple/staggered/external) per node — view +
      edit each node's own copy, since a folder can be versioned differently per
      node (params surfaced verbatim; staggered's `maxAge` shown in days)
- [x] Ignore patterns — view/edit per node, diff across nodes (fetched on
      demand per folder, not baked into the model; a per-node `.stignore` editor
      plus a cluster-level "patterns differ / identical" indicator)
- [x] Advanced folder options (rescan interval, watcher, min disk free) —
      view (a `Scanning:` summary on the share detail) + edit per node; the
      three knobs live on `Share.advanced` like `versioning`, since each node
      scans and guards its own copy
- [x] `sendonly` override + `receiveonly` revert — confirmation-gated buttons
      on the share detail, shown only for the matching folder type
- [x] Conflict & failed-item surfacing (per folder, cluster-rolled-up) —
      `Share.failedItems` count in the model (rolled up on the Overview KPI),
      with the per-item detail and the `*.sync-conflict-*` scan behind an
      on-demand "Conflicts & failed items" section on the folder detail
      (a tree walk per node is far too heavy for the refresh cycle)

### Device management

- [x] Pause/resume (fan-out), add device to chosen nodes
- [x] Remove device (fan-out to every registered node referencing it — same
      scope as pause; never from the device's own config)
- [x] Accept pending devices & folders — the cluster-wide "inbox" (Syncthing's
      pending API), merged across every registered node that reports the
      same device/folder. Accepting a device fans out to chosen nodes like
      Add device; accepting a folder is single-node (the offer was made to
      one node by one peer). An encrypted offer locks to receiveencrypted,
      enforced both client- and server-side. Dismissing is non-permanent —
      it resurfaces if seen again; a permanent per-device/folder ignore list
      isn't exposed yet.
- [x] Edit device options: name, addresses, compression, introducer,
      auto-accept, per-device rate limits — on-demand view of how every
      referencing node configures the device (not in the model; entries can
      differ per node), with a "nodes disagree" warning; applying writes one
      set of options to every referencing node (same fan-out scope as
      pause/remove) via Syncthing's element-scoped PATCH
- [x] Device identity: show ID/QR for any device — copy button (0.4.6) plus
      a toggleable QR image; the proxy relays the PNG from a registered
      node's own `/qr/` GUI endpoint (the same one Syncthing's UI uses), so
      neither proxy nor frontend needs a QR library

### Cluster operations

- [x] Pause all / resume all (devices or folders) — one mutation, one refresh
      for the whole batch; a partial failure still applies to and refreshes
      the rest, reported by node→target label (capped)
- [x] Rescan all (one batch, one refresh — same shape as pause all);
      restart/shutdown a node's Syncthing (per node, confirmation-gated;
      shutdown warns it can't be undone from here — a connection dropping
      mid-restart is treated as success, since Syncthing may exit before the
      response gets out)
- [x] Upgrade orchestration (one node at a time, health-checked) — a
      background sweep on the proxy (`POST /api/upgrade` starts it,
      `GET /api/upgrade` polls it): each node is version-checked, upgraded
      only if a newer release exists, and must come back reachable before
      the next node starts; any failure aborts the remainder so at most one
      node is ever mid-upgrade. One run at a time, in-memory. Surfaced as an
      Upgrades card on the Overview with live per-node progress
- [x] Config drift detection: same folder configured differently across nodes
      (label/type/versioning mismatches), asymmetric shares (A shares with B,
      B doesn't share back), with suggested fixes — the genuinely novel
      cluster-level feature a single-node GUI cannot have. Pure logic in
      `@clusterfuck/shared` (`detectDrift()`), surfaced as an Overview
      section; works on fixtures too. Suggested fixes are advisory text,
      plus a one-click **Apply fix** (live source) where the fix maps onto
      an existing safe mutation: label drift (rename outliers to the
      majority) and asymmetric shares (add the missing share-back entry) —
      findings needing a human choice stay text-only. Type checks flag only the
      genuinely broken all-sendonly / all-receiveonly cases, since pairwise
      type differences are normal topology; `Share` gained `label` (each
      node's own label) to make label drift detectable at all
- [x] Bandwidth limits cluster-wide — each node's *global* send/receive caps
      (per-device caps live in the device-options editor), viewed per node
      and settable on one node or every node in one action, via the
      element-scoped options PATCH

### Observability

- [x] Live state/completion/errors via events + SSE; overview dashboard
- [x] Per-node system status (version, uptime, listeners, discovery, RAM) —
      CPU deliberately excluded: Syncthing's own REST API documents
      `cpuPercent` as deprecated and always 0, so surfacing it would just be
      misleading UI clutter, not real information
- [x] Transfer totals, per link/device/cluster-aggregate — cumulative bytes
      in/out since each connection's current session started (resets on
      disconnect/restart, same as Syncthing's own counters)
- [x] Transfer *rates* (a live bytes/sec, not just the cumulative totals
      above) — the proxy samples each connection's cumulative counters
      across refresh cycles and derives `Connection.inBps/outBps`
      (sub-2s windows carry the previous rate forward to avoid event-storm
      noise; counter resets read as 0, disconnected links have no rate).
      Shown per link and summed on the device panel and Overview tile
- [x] Recent-changes feed, merged across nodes — each node's disk-events
      stream (`/rest/events/disk`, a second long-poll per node: Syncthing
      doesn't deliver change events on the default stream) feeds a bounded
      in-memory buffer on the proxy, served newest-first at `/api/changes`
      and shown as an on-demand Overview card. A glance, not an audit log —
      empty after a proxy restart by design
- [x] Raw event log (all event types, filterable) — everything both per-node
      event loops receive (default + disk streams), merged newest-first into
      a bounded in-memory buffer; `GET /api/events/log` with `types`/`node`/
      `limit` filters, plus an Overview card with type/node filtering. With
      this, Phase 5 Observability is complete
- [x] Completion history/sparklines on the overview tiles — the proxy
      samples each share's completion on its refresh cycle (≥30s apart,
      last ~120 points, in-memory like the changes feed) and serves it at
      `/api/history/completion`; the Overview's folder cards draw a tiny
      fixed-0–100 sparkline per share (honest scale: no min/max rescaling)

### Foundations these need

- [x] Node registration UI (add a node's URL + API key at runtime,
      persisted server-side) — replaces editing `cluster.json` by hand
- [ ] Auth on the proxy the moment it's exposed beyond localhost
- [ ] Syncthing 2.x REST support (currently targets 1.x)

## Phase 6 — Multi-cluster (2.0, parked)

One clusterfuck instance managing several independent Syncthing clusters —
e.g. home + offsite + a friend's cluster you administer — with one UI and a
cluster switcher. Workable today without any of this by running one proxy
process per cluster (own port + own `cluster.json`) and one browser tab each;
this phase folds that into a single instance.

**Why this is 2.0:** every proxy route gets re-namespaced under
`/api/clusters/:clusterId/...`, which breaks the API we promise stability for
at 1.0 — under SemVer that's a major bump. It also deliberately lands *after*
1.0's auth: multiplying the clusters behind one unauthenticated port
multiplies the blast radius, so auth is a hard prerequisite, not a nicety.
The normalized model already carries a cluster id + label, so
`packages/shared` should be untouched — this was designed in from Phase 1.

### Proxy

- [ ] Registry grows a cluster dimension: named clusters, each with its own
      node list. Migration: a bare single-cluster `cluster.json` is
      auto-wrapped into a default cluster on first load — no hand-editing
- [ ] One `ClusterStateManager` per cluster with an isolated lifecycle:
      event loops, poll backstop, and mutation queue per cluster, so one
      cluster's outage or slow node never stalls another's refreshes
- [ ] All routes re-namespaced `/api/clusters/:clusterId/...`; unknown
      cluster id is a distinct 404 from unknown route (the stale-proxy
      failure mode must stay diagnosable)
- [ ] Cluster CRUD at runtime (create/rename/delete, like node registration
      today) — deleting a cluster de-registers its nodes from *our* registry
      only, never touches the Syncthings themselves
- [ ] `/api/version` stays global (one process, one version)

### Web

- [ ] Cluster switcher in the header next to the existing Source dropdown;
      last selection remembered locally
- [ ] Data layer keyed by cluster id — model fetch, SSE subscription, and
      every mutation call carry the active cluster
- [ ] Fixtures need no changes (each already is a model with its own
      id/label — they were the multi-cluster case all along)
- [ ] Stretch: an all-clusters landing page (one health tile per cluster)
      before drilling into one

### Decisions to settle before building (flagged, not guessed)

- **SSE shape:** one stream per cluster (browser subscribes to the active
  one) vs. one multiplexed stream tagging models by cluster. Per-cluster is
  simpler; multiplexed enables the all-clusters landing page cheaply.
- **Same node in two clusters:** allow (they're independent views, at the
  cost of double-polling that node) or reject at registration like the
  duplicate-node check does today?
- **Auth granularity:** 2.0 minimum is one credential for the whole proxy;
  per-cluster access control is a plausible follow-up but out of scope
  unless a real need appears.
- **Transition:** hard cutover of route paths at 2.0.0, or keep unprefixed
  routes as a deprecated alias for the default cluster during one MINOR
  release. Hard cutover is cleaner; alias eases self-hosted upgrades.

See `docs/HOW-IT-WORKS.md` for the architectural context.
