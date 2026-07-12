# Backing up and restoring node configs

This is Tier 0 of the live-cluster hardening plan (`ROADMAP.md`): **before
clusterfuck's mutations are tested against real nodes, every node's config
must be backed up and the restore rehearsed once.** It's also just good
practice — everything here is useful independent of testing.

Two layers, because they answer different questions:

| Layer | What it's for | What it can do |
|---|---|---|
| File-level backup of each node's **config directory** | *Restore.* The authoritative rollback for anything a config mutation could break. | Fully revert a node's Syncthing config, keys included. |
| Per-node **`/rest/config` JSON dump** | *Diffing.* Take one before and after a test session and compare. | Show exactly what changed. Not a restore mechanism. |

Neither backs up your **synced data** — that's what your normal backups are
for. This is about the nodes' Syncthing *identity and configuration*.

## Layer 1 — file-level config backup (the restore path)

Each Syncthing node keeps its config in one directory. Don't guess the
location — ask the node:

```sh
curl -s -H "X-API-Key: $KEY" http://<node>:8384/rest/system/paths | grep -o '"config"[^,]*'
# or, with shell access on the node:
syncthing --paths
```

From that directory, the files that matter for a config restore:

- `config.xml` — the entire configuration (devices, folders, GUI/API settings).
- `cert.pem` + `key.pem` — the node's **device identity**. Lose these and the
  node gets a new device ID; every peer would have to re-accept it.
- `https-cert.pem` + `https-key.pem` — the GUI/API TLS keys (regenerated if
  missing, but restoring them avoids certificate-change warnings).

They're a few kilobytes. Back them up per node, dated:

```sh
mkdir -p backups/<node>-$(date +%F)
cp <configdir>/config.xml <configdir>/cert.pem <configdir>/key.pem backups/<node>-$(date +%F)/
```

Syncthing writes `config.xml` atomically, so copying from a running node is
safe in practice — but for the one rehearsed baseline backup per node,
stopping Syncthing first removes all doubt. **Treat these backups as
secrets**: `key.pem` *is* the device identity, and `config.xml` contains the
API key.

Also back up clusterfuck's own two files, which live next to the proxy (both
gitignored): `cluster.json` (node registry incl. API keys) and `auth.json`
(the proxy's access token, if GUI-managed).

## Layer 2 — REST config dumps (the diff path)

Before and after every test session that mutates anything:

```sh
curl -s -H "X-API-Key: $KEY" http://<node>:8384/rest/config > <node>-$(date +%F-%H%M).json
```

Then compare (sorted so key order can't produce noise):

```sh
diff <(jq -S . <node>-before.json) <(jq -S . <node>-after.json)
```

The diff should contain **exactly** the changes the session intended — and
nothing else. An unexpected line here is a finding, even if nothing looks
broken.

## Restore procedure

1. Stop Syncthing on the node.
2. Copy `config.xml`, `cert.pem`, `key.pem` from the backup into the config
   directory (overwriting).
3. Start Syncthing.
4. Verify: `curl -s -H "X-API-Key: $KEY" http://<node>:8384/rest/system/status`
   — `myID` must be the node's original device ID; the GUI should show the
   pre-backup config.

## Rehearsal checklist (once, on the sacrificial node — never skip)

An untested backup is a hope, not a rollback path. On the sacrificial node:

- [ ] Take the Layer 1 backup (Syncthing stopped).
- [ ] Start it again; make a clearly visible config change (e.g. rename a
      folder label in its GUI).
- [ ] Run the restore procedure above.
- [ ] Confirm the label change is gone and `myID` is unchanged.
- [ ] Note how long it took and anything surprising, in this file or the
      session notes.

Only after this checklist passes does Tier 1 (the throwaway cluster) start,
and only after Tiers 1–2 does anything mutate a real node (Tier 3).
