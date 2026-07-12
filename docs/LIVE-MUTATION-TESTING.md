# Graduated live mutations (hardening Tier 3)

The first time clusterfuck's mutations touch real nodes — done in a way
where the blast radius of any step is one junk folder and one disposable
device. Prerequisites: **all** of Tiers 0–2 (backups taken *and restore
rehearsed*, every mutation class green on the throwaway cluster, upgrade
rehearsal done on the sacrificial node, read-only soak clean). Checkboxes
live in `HARDENING-RUNBOOK.md`; this is the protocol.

## Setup

- The **sacrificial node** joins the real cluster: register it in the proxy
  (running *without* `CLUSTERFUCK_READONLY` now — this tier mutates).
- Create one junk folder — call it `cf-test`, junk data only — shared
  between the sacrificial node and **exactly one** real node (pick the one
  you'd miss least). Everything in this tier happens to `cf-test`, to the
  sacrificial device, or to nothing.

## The session protocol (every session, no exceptions)

1. **Before:** Layer 2 dumps of **every** node
   (`BACKUP-AND-RESTORE.md`) — not just the ones in scope.
2. Perform only the session's planned mutations, through the app.
3. **After:** dump every node again and diff.
4. The in-scope nodes' diffs must contain **exactly** the intended changes.
   Every out-of-scope node's diff must be **empty** — that's the
   blast-radius check, and it's the whole point of dumping all nodes.
5. Any unexpected line: **stop the session**, restore the affected node
   from its Tier 0 backup if the change is live-relevant, record the
   finding, fix it via the normal PR flow before continuing.

## Widening order (one class per session, least → most invasive)

1. **Rescan** `cf-test` on the real node.
2. **Folder pause/resume** on `cf-test`.
3. **Folder config on `cf-test`**: label, type (e.g. `receiveonly` on the
   sacrificial side, then revert), versioning, ignore patterns, advanced
   options.
4. **Share add/remove**: share `cf-test` to a second real node, verify,
   unshare.
5. **Device options** on the *sacrificial device's entry* as stored on the
   real node(s): addresses, compression, rate limits.
6. **Device pause/resume** of the sacrificial device — note this edits
   every referencing real node's config (only that device's entry; the
   diffs must show exactly that).
7. **Encryption password**: make the sacrificial node `receiveencrypted`
   for `cf-test`, verify ciphertext-only storage, clear it.
8. **Restart** of the sacrificial node via the app; **bandwidth caps** on
   the sacrificial node only.
9. **Create/remove via the dialogs**, scoped to sacrificial + one real
   node: a new device entry, a new folder; then remove both.

## Out of scope until after 1.0 sign-off

On real nodes: device **removal**, node **shutdown**, cluster-wide
**pause/resume-all**, and the **upgrade sweep**. All of these were
exercised on throwaway hardware in Tier 1 — that's where they stay until
the leg is signed off.

## Done when

Every class above is green with clean diffs and zero restores needed (or
every needed restore traced to a fixed finding and the class re-run
clean). That completes the hardening leg's definition of done — the 1.0
gate.
