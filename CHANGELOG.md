# Changelog

Format loosely follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/).
Versioning policy is in `CLAUDE.md`; the phased feature history is in
`ROADMAP.md` — this file is the terse, dated version-by-version log.

## [0.3.2]

- Fixed the share-mode arrowheads and lock badges added in 0.3.1 being hidden
  behind device nodes, exactly where they mattered most: they were drawn as
  raw SVG in the edge's own path at a fixed inset guess (18-34px), nowhere
  near enough to clear a ~120px+ wide device-node pill. Moved them into
  `EdgeLabelRenderer` and now compute the *exact* distance to each device
  node's own rendered boundary (via React Flow's measured node size —
  `useInternalNode`, approximating the pill as its bounding rectangle) so the
  arrow tip lands precisely at the node's edge and the lock sits a bit
  further out toward the middle — both entirely in the open space between
  the two nodes, so the node renders on top as normal without hiding either
  one. Also sized the arrowheads up ~40% and widened the gap between
  parallel lines so the bigger arrowheads don't crowd each other near a
  shared endpoint.

## [0.3.1]

- Nodes-mode graph: share mode (send/receive/encrypted) is now visible on the
  line itself, not just via the folder-identity color. Each end of a line
  independently gets an arrowhead if that device's own share type receives
  updates (everything except sendonly) — asymmetric shares (one side
  sendonly, the other receiveonly) read correctly since each end only
  depends on its own type. A 🔒 marks whichever end is receiveencrypted, and
  the whole line dashes when either end is. New "Share mode (line)" legend
  section explains the encoding. Extracted the pure graph-layout functions
  (`nodesGraph`/`foldersGraph`) out of `reactFlowAdapter.tsx` into a new
  `graphLayout.ts` (oxlint's react-refresh rule flags a file exporting both
  components and plain functions), making them directly unit-testable.

## [0.3.0]

- Phase 5: **Accept pending devices & folders** — the cluster-wide "inbox".
  `ClusterModel` gains `pendingDevices`/`pendingFolders`, merged across every
  registered node that reports them (the same device trying two nodes, or a
  folder offered on two nodes, shows up once). New proxy routes:
  `POST /api/pending/devices/:deviceId/accept`, `DELETE
  /api/pending/devices/:deviceId`, `POST
  /api/pending/folders/:folderId/devices/:nodeId/accept`, `DELETE
  /api/pending/folders/:folderId/devices/:nodeId`. Accepting a device fans out
  to chosen nodes (reuses `addDevice`); accepting a folder is single-node,
  rejected (400) unless the given `offeredBy` is actually currently offering
  that folder on that node. An offer with `receiveEncrypted: true` locks the
  accepted type to `receiveencrypted` both in the UI and in the API itself.
  New "Pending" section on the Overview page with Accept (opens a dialog) and
  Dismiss (non-permanent) per item.

## [0.2.2]

- Overview: cluster-wide Pause/Resume-all buttons now pick up the app's
  shared button styling (they were missing it entirely — only the color
  modifier classes were scoped to apply outside `.detail-panel`, so they
  rendered as unstyled browser-default buttons) and live in a proper
  "Cluster actions" card instead of a bare row under a heading.
- Overview: new "Nodes" section — a card per device (mirroring the existing
  Folders section, but folder-per-device instead of device-per-folder), with
  a connection-state badge and a clickable row per folder share that jumps
  straight to that share's detail.

## [0.2.1]

- Fixed the graph view unmounting to a blank screen with no visible error on
  a render-time exception (e.g. cluster data that doesn't match an expected
  shape) — the app had no error boundary anywhere, so any thrown error while
  rendering silently blanked the whole page. Added `GraphErrorBoundary`
  around the graph pane: shows the error message and a "Try again" button
  instead.
- Fixed the legend showing every folder-identity and folder-type swatch as
  gray regardless of its actual color. `.legend__swatch` is a height:0 box
  rendered via `border-top` (so dashed vs. solid edges are distinguishable),
  but the color was being set as `backgroundColor` — with zero height that
  never has visible area, so it silently fell back to a default border
  color. Now set as `borderTopColor`.
- The device detail view's folder-shares list is now clickable — selecting a
  row jumps to that share's full detail (stats, completion, and all the
  folder controls), instead of only being reachable via the folder-selection
  view.

## [0.2.0]

- Phase 5: **Per-share encryption passwords** — `POST
  /api/folders/:folderId/devices/:deviceId/shares` accepts an optional
  `encryptionPassword`, making the added (or an already-shared) peer
  untrusted/`receiveencrypted` on its own side. Write-only: never read back
  into the normalized model or any response. An explicit empty string clears
  a previously-set password; omitting the field leaves it as-is. Surfaced as
  an optional password field next to "Add device" in the folder-share panel.
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
