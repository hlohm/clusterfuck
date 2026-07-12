# Hardening runbook — Review & live-cluster hardening (pre-1.0)

The single execution checklist for the whole hardening stage. `ROADMAP.md`
tracks the leg at item level; **this file is where the actual work gets
ticked off**, session by session. Tick items via normal PRs (main is
protected), ideally one PR per completed session with a line in the
findings log. Procedure details live in the tier docs:
[BACKUP-AND-RESTORE.md](BACKUP-AND-RESTORE.md) ·
[dev-cluster/README.md](../dev-cluster/README.md) ·
[READONLY-SOAK.md](READONLY-SOAK.md) ·
[LIVE-MUTATION-TESTING.md](LIVE-MUTATION-TESTING.md).

**The one rule:** tiers run strictly in order. Nothing mutates a real node
until every box above Tier 3 is ticked.

---

## Tier 0 — backups & rollback rehearsal

Per `BACKUP-AND-RESTORE.md`.

- [ ] Sacrificial node provisioned (any box/VM that may be wiped; it also
      serves as the Tier 1b upgrade guinea pig and joins the real cluster
      in Tier 3).
- [ ] Layer 1 file backup taken for **every real node** (config.xml +
      cert.pem + key.pem; Syncthing stopped for the baseline copy). One
      line per node below, filled in as taken:
  - [ ] node `____________` — backed up `____-__-__`, stored at `____________`
  - [ ] node `____________` — backed up `____-__-__`, stored at `____________`
  - [ ] node `____________` — backed up `____-__-__`, stored at `____________`
  - [ ] *(add rows per node)*
- [ ] clusterfuck's own `cluster.json` + `auth.json` backed up.
- [ ] Backups stored somewhere that survives the node they back up, and
      treated as secrets (key.pem is the device identity).
- [ ] **Restore rehearsed on the sacrificial node**: backup → visible
      config change → restore → change gone **and `myID` unchanged**.
      Duration and surprises noted in the findings log.

## Tier 1 — throwaway cluster: every mutation class

Per `dev-cluster/README.md`. Worst case here is `rm -rf data`.

**Setup**

- [ ] `dev-cluster/setup.sh` ran clean; three nodes up (st1 = 1.x,
      st2/st3 = 2.x), GUIs reachable on 18384/28384/38384.
- [ ] All three registered in clusterfuck; Overview shows three managed
      nodes, per-node version chips, and the **mixed-major hint**.

**Topology (through the app only)**

- [ ] Devices cross-added (each node knows the other two); pending-device
      accept flow exercised at least once (accept from the app).
- [ ] Shared folder created across all three via the Add Folder dialog;
      syncs (drop a file on st1, appears on st2/st3).
- [ ] Pending-folder accept flow exercised at least once.
- [ ] Second folder created scoped to two nodes only; graph/Table render
      both correctly.

**Folder mutations**

- [ ] Pause / resume a folder (state reflects on the node's own GUI).
- [ ] Rescan (watch the scanning state).
- [ ] Label change; label **drift** provoked across nodes and the drift
      section's suggested fix applied.
- [ ] Type changes: `sendonly` on one node (+ **override** exercised),
      `receiveonly` on another (+ **revert** exercised), back to
      `sendreceive`.
- [ ] Versioning set/changed/cleared (at least trashcan + staggered),
      params round-trip intact on the node's own GUI.
- [ ] Ignore patterns edited per node; cross-node "patterns differ"
      indicator seen and resolved.
- [ ] Advanced options (rescan interval, watcher off/on, min disk free)
      edited and verified on the node.
- [ ] Folder removed from one node; then removed everywhere.

**Share / encryption**

- [ ] Share added and removed on an existing folder.
- [ ] **Encryption password** set for one peer (peer's copy becomes
      `receiveencrypted`, stores ciphertext only, 🔒 rendering correct);
      then cleared.

**Device mutations**

- [ ] Device pause / resume (from both the graph detail and Overview).
- [ ] Device options edited (addresses, compression, rate limits) and
      verified on the node's own GUI.
- [ ] Device removed and re-added.
- [ ] QR code shown for a device (relayed render works).

**Cluster operations**

- [ ] Pause-all / resume-all devices; pause-all / resume-all folders;
      rescan-all.
- [ ] Node-global bandwidth caps set per node and cluster-wide; verified
      via each node's GUI; cleared (0 = unlimited).
- [ ] Restart of one node via the app (comes back, model recovers).
- [ ] Shutdown of one node via the app (goes down and **stays** down;
      `docker compose start` brings it back).
- [ ] Upgrade sweep attempted against the containers — expected result:
      Syncthing's own "upgrade unsupported" error surfaces per node,
      nothing breaks (the containers can't self-upgrade by design).

**Cross-cutting checks (do throughout)**

- [ ] Every mutation was behind its confirmation/preview dialog.
- [ ] Partial-failure reporting seen at least once (e.g. stop st3, run a
      fan-out, exactly st3 reported failed).
- [ ] Mixed-major: every class above touched both the 1.x node and a 2.x
      node at least once across the tier.
- [ ] Proxy log clean after each session (no unhandled errors).

## Tier 1b — upgrade rehearsal (sacrificial node, release binary)

Not in containers — official images ship upgrade-disabled. On the
sacrificial node with a **1.x release-binary install**, registered in
clusterfuck (alone or alongside dev-cluster):

- [ ] Sweep on the 1.x node reports **`major-available`** (with the 2.x
      target version) and does **not** upgrade; run not aborted.
- [ ] "Upgrade including major…" path taken: confirmation shown, node
      upgrades to 2.x, **database migration observed**, node health-checked
      back, sweep reports done with from/to versions.
- [ ] A subsequent sweep reports the node up to date.
- [ ] (If a 2.x point release is available) a plain minor sweep upgrades
      normally.

## Tier 2 — read-only soak (real cluster)

Per `READONLY-SOAK.md`. Prereq: everything above ticked.

- [ ] Proxy started with `CLUSTERFUCK_READONLY=1` + auth token; **lock
      verified** (startup log line + a curl that bounced 403).
- [ ] Soak start date noted: `____-__-__`.
- [ ] Correctness pass early in the soak (app vs every node's own GUI).
- [ ] Observed: a sync burst; recent-changes/event log/states tracked it
      live with correct local/remote origins.
- [ ] Observed: a Syncthing node restart; app tracked it.
- [ ] Observed (ideally): a node offline ≥1h and back.
- [ ] Deliberate proxy kill + restart mid-soak: browser reconnected on its
      own; session survived.
- [ ] Daily proxy-log checks: zero unexplained errors after day 1.
- [ ] Memory (RSS) checked ~daily: plateau, not climb.
- [ ] Correctness pass late in the soak.
- [ ] ≥5 days elapsed; findings (if any) fixed and, where warranted, the
      clock restarted. End date: `____-__-__`.

## Tier 3 — graduated live mutations (real cluster)

Per `LIVE-MUTATION-TESTING.md`. Every session: dump **all** nodes before
and after; in-scope diffs = exactly the intended change; **out-of-scope
diffs empty**. One class per session:

- [ ] Setup: sacrificial node joined the real cluster; `cf-test` junk
      folder shared with exactly one real node.
- [ ] 1. Rescan `cf-test` — diffs clean.
- [ ] 2. Folder pause/resume — diffs clean.
- [ ] 3. Folder config (label, type incl. revert, versioning, ignores,
      advanced) — diffs clean.
- [ ] 4. Share add to a second real node, then remove — diffs clean.
- [ ] 5. Device options on the sacrificial device's entries — diffs clean.
- [ ] 6. Device pause/resume of the sacrificial device — diffs show
      exactly that entry on each referencing node, nothing else.
- [ ] 7. Encryption password on `cf-test` for the sacrificial node, then
      cleared — diffs clean.
- [ ] 8. Restart of the sacrificial node + bandwidth caps on it — diffs
      clean.
- [ ] 9. Create + remove a device and a folder via the dialogs
      (sacrificial + one real node) — diffs clean.

## Sign-off (the 1.0 gate)

- [ ] Every box above ticked (or its exception documented in the findings
      log with a fixed finding and a clean re-run).
- [ ] All findings fixed and merged; no known open correctness issues.
- [ ] Owner sign-off: `____________` date `____-__-__` — the hardening leg
      is done; start the 1.0 discussion (with the easier-installation leg
      per ROADMAP).

---

## Findings log

Append one row per finding or notable observation, newest first.

| Date | Tier | What happened | Resolution (PR / decision) |
|---|---|---|---|
| | | | |
