# dev-cluster — a throwaway Syncthing cluster

Three disposable Syncthing containers for exercising clusterfuck against
something real that is allowed to break. This is **Tier 1** of the
live-cluster hardening plan (`docs/HARDENING-RUNBOOK.md` is the checklist),
and doubles as a general development fixture: a live-ish cluster without
touching anything you care about.

Deliberately **mixed-major**: `st1` runs Syncthing 1.x, `st2`/`st3` run 2.x
— the same shape as a real cluster mid-migration, so the per-node version
chips, the mixed-major hint, and any behavior difference between the majors
are all visible here.

## Prerequisites

Docker with the compose plugin. Nothing else — the nodes generate their own
identities on first start.

## Start

```sh
./setup.sh
```

That brings the three nodes up, waits for them to generate configs, pins
each API key to a known value (`clusterfuck-dev-st1` …), restarts them, and
prints a ready-made `cluster.json`. The keys are deliberately public dev
fixtures — the GUIs/APIs only listen on `127.0.0.1`, and everything in
`data/` is throwaway (and gitignored).

Point clusterfuck at them (printed `cluster.json`, or the app's **Register
node** dialog), then wire the cluster up **through the app itself** — that's
the exercise: add each node as a device on the others, create a shared
folder, watch it sync. The nodes reach each other via local discovery on
the compose network; their GUIs are at `http://127.0.0.1:18384` / `28384` /
`38384` for cross-checking what Syncthing itself believes.

## What this cluster is for

Every mutation class the app has, in a place where the worst case is
`rm -rf data`: device add/remove/pause/resume/options, folder create/
remove/pause/rescan/type changes, shares with encryption passwords,
versioning, ignores, advanced options, bandwidth caps, restart/shutdown,
override/revert. The runbook lists them all as checkboxes.

**What it can't do: the upgrade sweep.** The official Syncthing images ship
with self-upgrade disabled, so `POST /rest/system/upgrade` fails by design
in these containers. Rehearse the upgrade sweep — especially the gated
1.x → 2.x major path — on the sacrificial node with a release-binary
install instead (runbook Tier 1b).

## Reset / teardown

```sh
docker compose down && rm -rf data   # full reset; next setup.sh starts fresh
```

If `setup.sh` can't edit the generated configs (files owned by another
uid), re-run it with `sudo`, or set `PUID`/`PGID` in the compose file to
your own ids and reset.
