# Changelog

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning policy is in `CLAUDE.md`; the phased feature history is in
`ROADMAP.md` — this file is the terse, dated version-by-version log.

## [0.2.0]

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
