# The read-only soak (hardening Tier 2)

Multi-day validation of everything the app *reads* against the real,
mixed-version cluster — with mutation provably impossible, not merely
avoided. Prerequisites: Tier 0 (backups taken, restore rehearsed) and
Tier 1 (every mutation class green on the throwaway cluster). The runbook
(`HARDENING-RUNBOOK.md`) carries the checkboxes; this doc is the procedure.

## Why read-only mode is the precondition

The proxy holds full API keys for every node, so "we just won't click
mutation buttons" is discipline, not safety. `CLUSTERFUCK_READONLY=1` makes
every mutating `/api` route answer 403 **at the gate, before routing** — the
soak instance cannot change the cluster no matter what is clicked, curled,
or triggered by a bug.

## Setup

```sh
CLUSTERFUCK_READONLY=1 \
CLUSTERFUCK_TOKEN=<a strong token> \
PORT=4000 \
pnpm --filter @clusterfuck/proxy start
```

with all real nodes in `cluster.json`. Then verify the lock before trusting
it:

- The startup log prints `CLUSTERFUCK_READONLY is set — all mutation routes
  answer 403`.
- A mutation actually bounces:
  `curl -s -X POST -H "Authorization: Bearer $TOKEN" http://localhost:4000/api/devices/X/pause`
  → `403 … read-only`.

Note the start date; the soak runs **at least five days** and should span
real cluster life: at least one sync burst (drop a big file in), one
Syncthing node restarting, and ideally one node going offline and coming
back.

## What to actually watch

**Correctness — the app vs. reality.** Once early on and once late, for
every node: compare the app against that node's own Syncthing GUI. Device
connection states, folder states and completion, out-of-sync/failed counts,
per-node versions (and the mixed-major hint, which your cluster should be
showing), uptime/RAM in the detail panel. The Table view is the easiest
side-by-side. Any disagreement that Syncthing's own GUIs don't have among
themselves is a finding.

**Liveness — events and streams.** Changes you make *via Syncthing* (drop a
file, rename a folder label in a node's own GUI) show up in the app within
seconds: recent-changes feed (right origin: local vs remote), event log,
folder states. Kill and restart the proxy mid-soak once: browsers reconnect
on their own (SSE), sessions survive (the cookie is restart-proof by
design).

**Stability — the proxy process.** Check the log daily: after the first
clean day there should be **zero** new `unhandled request error` /
`mutation failed` lines; event-loop backoff warnings are acceptable only
during a real node outage. Track memory roughly daily —
`ps -o rss= -p <proxy pid>` — it should plateau, not climb steadily.

## Findings

Keep a dated soak log (a text file is fine): what was checked, what was
seen. Every unexpected log line or UI/reality disagreement is a finding —
fix it via the normal PR flow. Small fixes don't reset the soak clock; a
fix in the aggregation/event path restarts the five days (judgment call,
noted in the log).

## Done when

Five-plus days spanning the events above, correctness checks clean, zero
unexplained proxy errors, memory flat, reconnects observed working — then
Tier 3 (`LIVE-MUTATION-TESTING.md`) may start.
