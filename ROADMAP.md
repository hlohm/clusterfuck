# Roadmap

The plan is phased and each phase is independently shippable. We don't start
management until the visualization reads cleanly, and we don't chase
cluster-wide parity until per-node actions are proven safe.

**Status:** Phases 1–5, the pre-1.0 UI refinement leg, and **Syncthing 2.x
support** (per-node version detection; shipped as **0.5.0**) are done — every
Phase 5 foundation included (auth: 0.4.22, GUI-managed 0.4.28). **(next)** is
the review & live-cluster hardening leg — its safe-testing strategy was
agreed with the owner 2026-07-12 and is itemized below — followed by the
easier-installation leg, both before 1.0. Phase 6 (multi-cluster +
multi-user, 2.0) stays parked.

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
- **Targets Syncthing 1.x's REST shape** — revisited 2026-07-12: the proxy
  now supports 1.x and 2.x per node (see the Syncthing 2.x leg below).

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
- [x] Auth on the proxy the moment it's exposed beyond localhost — opt-in
      shared token: scripts send it as a Bearer header, browsers exchange it
      once at a login screen for an HttpOnly `SameSite=Strict` cookie
      (stateless HMAC of the token, so restarts don't log anyone out and
      rotating the token revokes every session). The proxy also serves the
      built web app (`packages/web/dist`, or `CLUSTERFUCK_WEB_DIST`) so
      production is one process on one origin
- [x] Manage auth from the GUI — a Settings overlay (⚙ in the header)
      initialises auth on an open proxy, rotates the token, or auto-generates
      a strong one; the token persists in a gitignored `auth.json` (raw, mode
      0600, `CLUSTERFUCK_AUTH_CONFIG` to relocate) via `PUT /api/auth/token`.
      `CLUSTERFUCK_TOKEN` stays **authoritative** when set — the GUI then only
      reveals/copies it (read-only, like Syncthing's own API-key display) and
      signs out. The GUI can never *disable* auth (that needs removing the
      auth file + restarting the proxy, out-of-band), so a hijacked session
      can't reopen the door
- [ ] Syncthing 2.x REST support — **decision settled** (per-node version
      detection; owner, 2026-07-11), itemized as its own leg below and
      shipping as 0.5.0

## UI design refinement (pre-1.0)

A polish pass on legibility and layout before calling the UI stable for 1.0
— requested by the owner (2026-07-09), worked as its own leg so feature
items don't absorb ad-hoc UI changes.

- [x] **Folder editing view legibility** — the detail sidebar is re-sizable
      (drag the divider, or focus it and use arrow keys; width persisted per
      browser, clamped 260–640px), and Versioning/Advanced are `<details>`
      fold-outs, collapsed by default, each summarizing its current config
      in the collapsed header so folding loses no information.
- [x] **React Flow attribution legibility** — the attribution chip now uses
      the app's own theme variables (translucent `--bg` behind `--text`), so
      it reads on both surfaces. Attribution kept, only restyled.
- [x] **Overview sections fold-out & re-arrangeable** — every section below
      the KPI row renders through one `OverviewSection` wrapper: a header
      bar with a collapse toggle and move-up/down controls. Collapse state
      and order persist per browser; a saved order survives sections being
      added in later builds (they slot into their default position), and
      moves skip over currently-empty sections so they never look like
      no-ops. Layout logic is pure and unit-tested (`sectionLayout.ts`).

## Syncthing 2.x support (0.5.0) ✅

The last Phase 5 foundation. **Decision settled (owner, 2026-07-11):
per-node version detection** — the owner's live cluster is already mixed
1.x/2.x, so the proxy adapts to each node's actual version instead of
assuming one cluster-wide. Completing this leg ships as **0.5.0**.

What actually differs (researched 2026-07-11 against the official docs repo
diffed across the 2.0 release boundary, and the v2.0.0 release notes — the
REST subset this proxy consumes is largely stable across 2.0):

- `/rest/system/connections` no longer lists the local device itself, and
  connection `type` strings changed format back in 1.25 (`tcp-client` vs
  `TCP (Client)`). We read neither today; tests must pin that.
- `/rest/db/status` deprecates `invalid` and `version` (both unused here)
  and its `errors` field may be absent — already tolerated by the
  `pullErrors ?? errors ?? folder-errors-length` fallback chain, needs a
  2.x-shape test.
- The config schema dropped `weakHashThresholdPct`, `disableTempIndexes`,
  `databaseTuning` and `gui.debugging`; 2.1 adds `folder.group`. Our config
  writes are GET-modify-PUT round-trips that never invent fields, so absent
  fields pass through — needs 2.x-shape tests.
- The legacy `/rest/system/config` endpoint and the debug endpoints are
  gone in 2.x (this proxy never used either).
- On a 1.x node the upgrade check can now offer a 2.x release as `latest`
  with `majorNewer: true` — and the upgrade sweep currently ignores that
  flag, so "Upgrade all" would silently jump a node across the major.

- [x] Per-node version surfaced first-class: the model carries each
      registered node's Syncthing version (+ parsed major) from the probe
      the snapshot already does; shown in the UI where nodes appear;
      fixtures gain a mixed 1.x/2.x cluster and the coverage test enforces
      the field.
- [x] 2.x response-shape compatibility: per-endpoint tests feeding
      2.x-shaped responses (connections without the self entry, db/status
      without `errors`, config without the removed fields) through
      snapshot/aggregate; fix anything that assumed 1.x shapes; per-endpoint
      compat notes in `syncthing/types.ts`.
- [x] The upgrade sweep never crosses a major version silently:
      `majorNewer`-only nodes are reported as such and skipped by the
      normal sweep; a major upgrade is its own explicitly-confirmed action
      (mirroring Syncthing's own GUI treating majors specially).
- [x] Docs: README/HOW-IT-WORKS supported-versions story; CHANGELOG 0.5.0
      milestone entry.

## Review & live-cluster hardening (pre-1.0) **(next)**

An extensive review-and-refinement pass validating the whole surface against
the owner's real, mixed-version cluster. **Strategy agreed with the owner
2026-07-12**, tiered so no tier can hurt anything the previous tier didn't
already prove safe. Work the tiers in order. **Execution is tracked
box-by-box in [docs/HARDENING-RUNBOOK.md](docs/HARDENING-RUNBOOK.md)** —
this section stays item-level; the runbook is where sessions get ticked
off and findings logged.

### Tier 0 — backups & rollback rehearsal (before any live contact)

- [x] Document the backup procedure (docs-only — decision, owner
      2026-07-12: no proxy backup endpoint, zero new attack surface —
      shipped as `docs/BACKUP-AND-RESTORE.md`):
      per-node **file-level backup of the Syncthing config directory**
      (`config.xml` + device certs/keys — the authoritative restore), plus a
      curl one-liner for per-node `/rest/config` JSON dumps used to **diff**
      config before/after each test session (not for restore).
- [ ] Rehearse a full restore once on the sacrificial node before any real
      node is touched — an untested backup is a hope, not a rollback path.

### Tier 1 — throwaway cluster (every mutation, incl. the scary ones)

- [x] In-repo `docker compose` dev/test cluster (`dev-cluster/`): three
      disposable Syncthing containers, deliberately mixed-major (1.x +
      2×2.x), wired into a cluster *through the app itself*. Doubles as a
      permanent dev fixture and as groundwork for the Docker install below.
- [ ] Exercise **every mutation class** against it: folder CRUD, type
      changes, versioning, ignores, encryption passwords, device options,
      pause/resume, restart/shutdown, bandwidth caps (itemized as
      checkboxes in `docs/HARDENING-RUNBOOK.md`).
- [ ] **Upgrade-sweep rehearsal incl. the real 1.x → 2.x major path** — on
      the **sacrificial node with a release-binary install**, not in the
      compose cluster: the official Syncthing images ship with self-upgrade
      disabled, so `POST /rest/system/upgrade` can't work there (deviation
      from the original plan, discovered while building Tier 1).

### Tier 2 — read-only soak (real cluster, provably safe)

- [x] **`CLUSTERFUCK_READONLY=1` proxy mode** — every mutation route
      answers 403 at the gate (decision, owner 2026-07-12: build it; the
      soak must be provably read-only, not discipline-based — and it stays
      useful as a dashboard-only deployment mode).
- [ ] Multi-day soak with all real nodes registered, readonly on:
      aggregation correctness, mixed-major rendering, event-stream
      stability, memory; finishes with zero proxy errors.

### Tier 3 — graduated live mutations

- [ ] Sacrificial node joins the real cluster; one new junk folder shared
      between it and **one** real node. Mutations start against that
      folder/node pair only, with Tier 0's pre/post config diffs checked
      every session; scope widens one mutation class at a time as each
      proves clean.

**Definition of done (the 1.0 gate):** every mutation class green on the
throwaway cluster including a real major upgrade; restore rehearsed; the
read-only soak clean; Tier 3 diffs clean.

## Easier installation (pre-1.0)

Owner (2026-07-12): "clone + pnpm install" is fine for development, not for
users — ship low-friction installs before 1.0. npm publishing was considered
and deliberately skipped (name/ongoing-surface concerns).

- [ ] **Docker image + compose example** — one container serving the proxy
      and the built web app on one origin; volumes for `cluster.json` /
      `auth.json`; published to GHCR via GitHub Actions (which the repo
      doesn't have yet — the image build is the occasion to add CI).
- [ ] **Release tarball + systemd unit docs** — web app pre-built into the
      tarball so Node 24 is the only requirement (the proxy runs its `.ts`
      source natively); documented unit file. The no-Docker path.
- [ ] **Low-friction Windows option** — on the map per the owner, low
      priority; approach (winget / scoop / zip-with-launcher) deliberately
      TBD until picked up.

## Phase 6 — Multi-cluster + multi-user (2.0, parked)

The 2.0 jump bundles two features that reinforce each other: **multi-cluster**
(one instance managing several independent Syncthing clusters) and
**multi-user auth** (real accounts, not one shared token). Multi-cluster on
its own is relatively mechanical; pairing it with multi-user — where "who can
see/touch which cluster" becomes a real question — is what justifies a major
version rather than a minor one (owner's call, 2026-07-11).

### Multi-cluster

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

### Multi-user auth

1.0 ships **one shared token** — knowing it makes you the admin, no accounts.
2.0 grows that into real users, which the GUI auth work (Settings overlay,
`auth.json` store, `PUT /api/auth/token`) already lays the groundwork for: the
overlay becomes the place accounts are created/managed, and the token store
becomes a user store.

- [ ] User records (name + password hash + role) persisted alongside the
      token store, still gitignored, still raw-secret-free in the repo
- [ ] Login exchanges username+password for the session cookie; the cookie
      carries which user (not just "the token holder"), so revocation and an
      audit trail of *who* did what become possible — both called out as
      honest limits of the single-token model in `docs/HOW-AUTH-WORKS.md`
- [ ] Roles at least read-only vs. admin; per-cluster access control is the
      natural intersection with multi-cluster above (a user sees a subset of
      clusters) — the reason the two features share the 2.0 jump

**Decisions to settle:** whether to keep the shared-token path as a
"single-user mode" alongside accounts (simplest self-host) or replace it
outright at 2.0; password hashing choice (scrypt/argon2); whether roles are
global or per-cluster from day one.

See `docs/HOW-IT-WORKS.md` for the architectural context.
