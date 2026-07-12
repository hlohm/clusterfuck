# CLAUDE.md — working context for clusterfuck

Guidance for an agent working on this repo autonomously. `README.md` is the
canonical statement of *what* we're building and *why*; this file is *how* to
work on it effectively. If the two ever disagree, the README wins — and flag the
drift.

## What this is (one paragraph)

A web app that renders a Syncthing cluster as a **graph** — devices as nodes,
shared folders as edges — so the topology and its sync semantics are legible at
a glance, and (later) lets you manage nodes and the cluster. React + TypeScript
SPA. Data comes from Syncthing's REST API via a thin proxy/backend that holds
the API keys; the browser never sees a key.

## Current state

Phases 1–5 and the pre-1.0 UI-refinement pass are **shipped** (fixtures →
live read-only → per-node management → multi-view visual refresh →
cluster-wide Syncthing-GUI parity, proxy auth included: opt-in token since
0.4.22, fully GUI-managed since 0.4.28 with `CLUSTERFUCK_TOKEN` still
authoritative when set). **Syncthing 2.x support shipped as 0.5.0** —
per-node version detection (owner, 2026-07-11): 1.x/2.x nodes mix freely,
and the upgrade sweep never crosses a major without explicit opt-in. Current
leg: review & live-cluster hardening — the tiered safe-testing strategy is
agreed (owner, 2026-07-12) and itemized in `ROADMAP.md`; **work its tiers in
order and never touch the owner's live cluster outside what the current tier
allows**. An easier-installation leg follows, then 1.0.
`ROADMAP.md` is the authoritative, itemized status — check it (and
the current version in the root `package.json`) before assuming what exists.
The monorepo is three workspace packages: `packages/shared` (the normalized
model + pure logic), `packages/proxy` (Node/TS backend), `packages/web`
(React SPA).

## Operating principles (read before you build)

- **Respect the phase gates.** Work through `ROADMAP.md` in its priority
  order, one coherent item per PR. Don't pull a later phase's feature into an
  unrelated change "while you're in there" — a new capability (e.g. anything
  needing auth, or Syncthing 2.x support) lands as its own deliberate step.
- **Raise flagged decisions; don't silently guess them.** The README marks
  specific *open decisions* per phase (graph library, the visual encoding for
  the four folder types, hyperedge vs. pairwise edges, proxy language, node
  registration/key handling, which cluster-wide actions ship). For those, lay
  out the options and trade-offs and ask — don't unilaterally lock them.
- **But do make reversible local choices autonomously**, and write them down.
  File/module layout, component boundaries, test structure, helper libraries,
  naming — decide, proceed, and note the choice in the PR. The bar is: *could a
  reviewer cheaply reverse this later?* If yes, just do it. If no, it's a
  flagged decision.
- **Small, reviewable PRs on topic branches.** `main` is protected — never
  commit to it directly. One coherent change per PR, with a description of what
  it does and any decisions made or deferred.
- **Green before commit.** Typecheck, build, lint, and tests must pass. Don't
  commit a broken tree; don't disable a check to make it pass.
- **No secrets in the repo, ever.** API keys, tokens, and any real endpoint
  details live in local, untracked config (see "Dev data"). Assume everything
  committed here is public.

## Architecture guardrails

- **The normalized cluster model is the contract.** It lives in
  `packages/shared` (`ClusterModel` + pure logic) and is the seam between
  proxy and frontend: the proxy produces it, the frontend consumes it, and
  fixtures conform to it. Devices, folders, shares (folder↔device with a
  type), connections, and pending items all live in this model — changes to
  its shape ripple everywhere, so treat them as significant.
- **Keys stay server-side.** The frontend talks only to the proxy and never
  holds a Syncthing API key. This is why a browser-only build isn't an option
  (CORS + key handling).
- **Every mutation is gated.** All mutation routes (Phase 3+) sit behind a
  confirmation or preview dialog in the UI, mirror Syncthing's own config/
  action model rather than inventing higher-level operations, fan out with
  `allSettled` and report exactly which nodes failed. Proxy auth is **opt-in**:
  a token turns on gating for every `/api/*` route (bar the health/version/
  auth/login handshake), enforced via Bearer header or login cookie — never
  expose the proxy beyond a trusted network without it. The token comes from
  either `CLUSTERFUCK_TOKEN` (authoritative when set) or a gitignored
  `auth.json` the GUI manages (Settings overlay: initialise/rotate/generate,
  `PUT /api/auth/token`). The GUI can enable and rotate but **never disable**
  auth — that requires removing the auth file/env var and restarting.

## Syncthing domain primer (you'll need this constantly)

**Folder types** — an edge's type is a property of the *folder on a given
device*, and the visual encoding must distinguish all four:

- `sendreceive` — normal two-way sync.
- `sendonly` — pushes local changes out; ignores remote changes (can sit
  "locally changed / out of sync" by design).
- `receiveonly` — accepts remote changes; local changes aren't sent (revertable).
- `receiveencrypted` — an *untrusted* device: it stores only ciphertext and holds
  no folder password. On the trusted senders, that peer's share carries an
  encryption password; the encrypted peer's copy of the folder is
  `receiveencrypted`. Two encrypted peers can relay ciphertext to each other.
  This is the case most tools render poorly — make it first-class.

**States you'll surface** — device: this-device / connected / disconnected /
paused. Folder: idle (up to date) / scanning / syncing / paused / error /
out-of-sync. Roll folder health up onto the node, but keep per-folder detail
available on selection.

**REST API shape** (auth via `X-API-Key` header) — the normalized model is
assembled from roughly: `/rest/system/status` (this device's ID),
`/rest/system/connections` (per-device connection state),
`/rest/config` (devices, folders, shares, types),
`/rest/db/status` and `/rest/db/completion` (folder state, out-of-sync, sync %),
and the long-polling `/rest/events` stream (state changes, completion,
connect/disconnect) for live updates. Endpoint/config details differ between
Syncthing 1.x and 2.x — target the version actually deployed and don't hardcode
assumptions that break across the two. Reference: the official REST API docs.

**Multi-node truth** — each node has its *own* view of the cluster, and views
disagree (e.g. connection state seen from both ends, differing completion).
Phase 2's aggregation has to merge them into one model and reconcile conflicts;
design the model with that in mind even in Phase 1.

## Dev data

- **Fixtures** (`packages/web/src/fixtures/`) are hand-authored clusters
  conforming to the normalized model, selectable from the app's Source
  dropdown. They deliberately cover the full matrix — all four folder types,
  each device/folder state including error and paused, a folder shared across
  3+ devices, a `receiveencrypted` node, pending devices/folders — and a
  coverage test enforces it. When the model grows a feature, extend the
  fixtures (and the coverage test) in the same PR so the UI stays explorable
  without a live cluster.
- **Live clusters:** connection details (endpoints + API keys) come from **local,
  untracked config** — a `.env.local`, or the gitignored `cluster.json` (the
  proxy's one canonical node registry, read at startup and kept in sync with
  nodes registered/removed at runtime via the app itself — see Phase 5's node
  registration UI). Never hardcode endpoints or keys, never commit them; read
  them from the environment or that file. Keep such files in `.gitignore` from
  the first commit that introduces them.

## Conventions

- **TypeScript strict.** Prefer explicit types on the cluster model and public
  module boundaries.
- **Test the logic that isn't visual** — the normalized model, fixture
  validity, the multi-node aggregation/reconciliation, snapshot mapping, and
  the pure view helpers (versioning/ignores). Visual components can lean on
  lighter tests.
- **Keep the model documented.** When the normalized model or a flagged decision
  changes, update the README/model docs in the same PR.
- **Commit messages:** imperative subject, short body explaining *why* and
  noting any decision made or deferred.
- **Versioning.** One SemVer number for the whole app, kept in lockstep across
  the root and all three workspace packages' `package.json` (they're private
  and always move together — never versioned independently). We're pre-1.0:
  MINOR bumps for a shipped roadmap milestone (see `ROADMAP.md`), PATCH for
  fixes/polish in between, and 1.0.0 is reserved for when the proxy has auth
  and the model/API are considered stable enough to promise compatibility.
  Bump the version in the same PR that ships the milestone/fix, and add an
  entry to `CHANGELOG.md`. The proxy exposes its own version at
  `GET /api/version` and the web build shows its own next to the logo — the
  two are meant to be compared, since a mismatch usually means a stale
  running proxy process (the failure mode is a generic 404; see the "no
  route for ..." log line in `packages/proxy/src/server.ts`).

## Definition of done — every PR

- [ ] Typecheck / build / lint / tests green (`pnpm typecheck && pnpm lint &&
      pnpm test && pnpm build` from the root); landed via a topic-branch PR,
      never on `main`.
- [ ] New logic that isn't purely visual has tests; fixtures/coverage test
      extended if the model grew.
- [ ] Docs updated in the same PR: `ROADMAP.md` checkboxes for shipped items,
      `CHANGELOG.md` entry + lockstep version bump per the policy above,
      README/proxy README if routes or user-facing behavior changed.
- [ ] Flagged decisions raised, not silently locked; reversible local choices
      noted in the PR description.
