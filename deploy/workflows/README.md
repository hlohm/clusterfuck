# Parked GitHub Actions workflows

These are complete, ready-to-run workflows that **cannot be pushed to
`.github/workflows/` from the agent's environment**: the repo's PAT lacks
the `workflow` scope, and GitHub refuses pushes that create or modify
workflow files without it.

To activate them, either:

1. **Give the PAT the `workflow` scope** (GitHub → Settings → Developer
   settings → your token → add `workflow`), after which the agent can move
   these into `.github/workflows/` in a normal PR — or
2. **Move them yourself**: `git mv deploy/workflows/*.yml .github/workflows/`
   on a branch and merge it (or add them via the GitHub web UI).

| File | Trigger | What it does |
|---|---|---|
| `ci.yml` | every PR / push to main | the four gates: typecheck, lint, test, build |
| `docker-publish.yml` | tag `v*` | builds the Docker image and pushes it to GHCR |
| `release-tarball.yml` | tag `v*` | builds the release tarball and attaches it to the GitHub release |
| `desktop-build.yml` | tag `v*` | builds the Electron app on a Windows/macOS/Linux matrix and attaches the installers |

The publish workflows call the same `Dockerfile` / `scripts/` used for
local builds — no logic lives only in the workflow.
