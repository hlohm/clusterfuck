# How the auth works

A tour of clusterfuck's authentication for a reader who knows their way
around IT — accounts, cookies, API keys as concepts — but doesn't write
code. Companion to [HOW-IT-WORKS.md](HOW-IT-WORKS.md), which explains the
architecture this sits on.

## Why the proxy needs a lock at all

The proxy is the powerful part of the system. It holds every node's
Syncthing API key, and its own API can read the whole cluster and change it
— pause devices, delete folders, restart Syncthings. Anyone who can reach
the proxy's port can do all of that. On your own desk that's fine; the
moment the proxy is reachable from anywhere you don't fully trust (a shared
LAN, a VPN with guests, the internet), it needs a lock.

The lock is **opt-in**. Start the proxy with nothing configured and it
behaves like it always did — open, with a loud warning in its log. Set one
environment variable and everything is gated:

```sh
CLUSTERFUCK_TOKEN='pick-a-long-random-string' pnpm --filter @clusterfuck/proxy start
```

## One token, not accounts

There are no usernames, no user database, no password reset. There is **one
shared secret** — the access token — and knowing it means you're the admin.
That's the same trust model as Syncthing's own GUI (one API key, one
optional GUI password per node): this is a tool one person, or a few
mutually-trusting people, run for themselves.

The token is chosen by you (any long random string) and lives in the
proxy's environment, next to the API keys it already guards. It is never
written to `cluster.json` and never appears in the repo.

## How a browser signs in

The first time you open the app against a locked proxy, you get a login
screen with one field. You paste the token once, and two things happen:

1. The app sends it to the proxy (`POST /api/login`), which checks it.
2. The proxy answers with a **cookie** — a small value your browser stores
   and automatically attaches to every later request. From then on that
   browser is signed in; you won't see the login screen again until the
   cookie expires (30 days) or is revoked.

Why a cookie rather than just remembering the token in the page? Two
reasons:

- **The live stream needs it.** The app's real-time updates arrive over a
  long-lived stream (Server-Sent Events). Browsers don't allow custom
  headers on that kind of connection — but they attach cookies to it
  automatically. The cookie is what lets the live view authenticate.
- **The cookie is `HttpOnly`,** which means the page's own JavaScript can
  never read it. Even if a malicious script somehow ran inside the app, it
  couldn't steal the credential from the cookie.

### What the cookie actually contains — and why that's clever-but-simple

The cookie is *not* the token. It's a **fingerprint derived from the token**
(an HMAC — a one-way cryptographic mix of the token with a fixed label).
Two useful properties fall out of that:

- **The proxy keeps no session list.** It can check any cookie by
  re-deriving the fingerprint from the token it knows. Restart the proxy
  and every signed-in browser stays signed in — there was nothing in memory
  to lose.
- **Rotating the token is a master logout.** Change `CLUSTERFUCK_TOKEN` and
  restart: the fingerprint changes, so every cookie in every browser
  everywhere stops working at that instant. That's the emergency lever if
  the token ever leaks.

The trade-off is symmetrical: there's no "log out that one browser over
there" — the only remote revocation is rotating the token (which logs out
everyone). For a single-admin tool, that's the right simplicity.

## A second browser, your phone, a colleague

The cookie lives in one browser. It doesn't transfer — and doesn't need to.
On any new browser or device you just paste the same token once at the
login screen.

Don't have the token at hand? Any browser that *is* signed in can retrieve
it: the Overview's cluster-actions card has an **Access** row with a
"Show access token" button (and a copy button). That reveal only works for
an already-authorized session — the same stance as Syncthing's own GUI
showing its API key in settings. **Sign out** lives next to it.

## Scripts and automation

Programs don't do login screens. Any script or `curl` sends the token
directly with each request, as a standard bearer header:

```sh
curl -H 'Authorization: Bearer YOUR-TOKEN' http://proxy:4000/api/cluster
```

No cookie involved, nothing stored, works statelessly.

## What stays open, deliberately

Four small endpoints answer without credentials even when the lock is on:

| Endpoint | Why it's open |
|---|---|
| `GET /api/health`, `GET /api/version` | monitoring probes — they reveal nothing about the cluster |
| `GET /api/auth` | "is a login required, and am I signed in?" — the question the app must be able to ask *before* logging in |
| `POST /api/login`, `POST /api/logout` | the handshake itself (logout must work even with a dead session, or a revoked browser could never clear its cookie) |

The web app's files (the login screen included) are also served without
credentials — the *data* is locked, not the door. Everything else under
`/api/*`, including the live stream and every management action, requires
the token or the cookie.

## When a session ends

Cookies expire after 30 days, and rotating the token kills them instantly.
The app handles this gracefully: the moment any request comes back
"unauthorized", the app returns you to the login screen — including the
live stream, which can't see the rejection directly and instead double-checks
its standing when the connection drops. Paste the token again and you're
back where you were.

## Honest limits

- **No encryption by itself.** The proxy speaks plain HTTP. On a trusted
  home LAN that's usually acceptable; across the internet the token and
  cookie would be readable in transit. Put HTTPS in front (a reverse proxy
  like Caddy, or a VPN/Tailscale tunnel) before exposing it beyond networks
  you trust. For the same reason the cookie deliberately omits the
  browser-side "HTTPS-only" flag — it would silently break plain-HTTP LAN
  setups.
- **One credential, full power.** Anyone with the token is the admin. There
  are no roles, no read-only mode, no audit trail of *who* did what.
- **The reveal shows the real token.** Anyone signed in can read it. That's
  by design (it's how you sign in elsewhere) — but it means "signed in
  once" equals "can stay in forever," so rotate the token if a device you
  don't control was ever signed in.
- Comparisons are constant-time and the token never appears in URLs or
  logs, but none of that substitutes for the transport encryption above.

## Where this is going

Auth was the last hard gate before a 1.0 (see `ROADMAP.md`): with it, the
proxy can be exposed beyond localhost, and the parked multi-cluster plans
(Phase 6) become possible — multiplying clusters behind one *unauthenticated*
port was never acceptable, which is why auth had to come first.
