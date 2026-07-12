# Installing clusterfuck

Three ways to run it, easiest first. All of them end at the same place: one
process serving the API and the web app on one origin (port 4000 by
default), with two state files — `cluster.json` (node registry) and
`auth.json` (access token, once you enable auth from Settings ⚙).

Whichever route you take: after first start, open the app, register your
nodes, and **enable auth before exposing the port beyond localhost**
(Settings ⚙ → Generate & enable; see
[HOW-AUTH-WORKS.md](HOW-AUTH-WORKS.md)).

## Docker (recommended)

Once the GHCR publish workflow is active (see `deploy/workflows/README.md`),
images live at `ghcr.io/hlohm/clusterfuck`. Until then, build locally:

```sh
git clone https://github.com/hlohm/clusterfuck && cd clusterfuck
docker build -t clusterfuck .
mkdir data          # holds cluster.json + auth.json
docker run -d --name clusterfuck -p 4000:4000 -v "$PWD/data:/data" clusterfuck
```

Or with compose: copy `deploy/docker-compose.example.yml`, adjust, `docker
compose up -d`. Useful environment variables (full table in the README):
`CLUSTERFUCK_TOKEN` (ops-managed auth), `CLUSTERFUCK_READONLY=1`
(dashboard-only instance).

## Release tarball + systemd (no Docker)

The tarball has the web app pre-built and no install step — **Node.js 24+
is the only requirement** (the proxy runs its TypeScript sources natively).
Download `clusterfuck-<version>.tar.gz` from the GitHub release (once the
release workflow is active; until then build it from a checkout with
`pnpm install && scripts/make-release-tarball.sh`), then:

```sh
tar -xzf clusterfuck-<version>.tar.gz
cd clusterfuck-<version>
./start.sh        # serves http://localhost:4000
```

For a service: the bundled `clusterfuck.service` assumes `/opt/clusterfuck`
and a `clusterfuck` system user with state in `/var/lib/clusterfuck`:

```sh
sudo useradd --system --home /var/lib/clusterfuck --create-home clusterfuck
sudo mv clusterfuck-<version> /opt/clusterfuck
sudo cp /opt/clusterfuck/clusterfuck.service /etc/systemd/system/
sudo systemctl daemon-reload && sudo systemctl enable --now clusterfuck
```

Upgrading = unpack the new tarball over `/opt/clusterfuck` (or swap a
symlink) and restart; state lives in `/var/lib/clusterfuck` and is
untouched.

## From source (development)

See the README's Quick start — `pnpm install && pnpm dev`.

## Desktop app (planned)

An Electron bundle — double-click app that runs the proxy and opens the UI
in its own window, aimed at the low-friction Windows case — is on the
roadmap ("Easier installation"). Not built yet.
