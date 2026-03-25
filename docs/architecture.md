# Architecture

## Overview

Deployery is a self-hosted sandbox runtime centered around `code-server`.

The current design is:

- one Docker image
- one public HTTP port
- one persistent sandbox filesystem
- one API app
- one database connection

## Runtime Shape

The main pieces are:

- `apps/api`
  - public HTTP server
  - workflow API surface
  - health and metrics endpoints
  - reverse proxy to private `code-server`
- `code-server`
  - runs inside the sandbox container itself
  - is exposed through the API proxy on the public port
- persistence via Drizzle schemas
  - SQLite by default
  - optional PostgreSQL for externalized state
- persistent sandbox system paths
  - `/usr`, `/etc`, `/var`, `/opt`, and `/home/user` are persisted directly
  - this keeps user-installed packages, configs, desktop apps, and user state
    across restarts
  - transient runtime paths such as `/tmp` and `/run` stay ephemeral
- outer sandbox container
  - provides the isolation boundary around the persistent guest environment
  - may run in compatibility mode (plain Docker) or hardened mode (`runsc`)
  - should be treated as hostile code execution from the host's perspective
  - in plain `runc` mode, Deployery uses an explicit desktop-friendly seccomp
    posture so browser and Electron namespace sandboxes can still initialize
  - optional NVIDIA GPU reservations are exposed for AI and compute workloads in
    the plain `runc` profile

## Repo Layout

```text
apps/api
packages/persistence
packages/workflow-engine
packages/workflow-schema
packages/cli
packages/extension-desktop
docker/image
docs
```

## Public Surface

Deployery serves:

- `/`
  - `code-server`
- `/api/*`
  - Deployery API
- `/webhook/*`
  - workflow webhook endpoints
- `/healthz`
  - liveness check
- `/healthz/readiness`
  - readiness check
- `/metrics`
  - Prometheus-style metrics

## Current Terminology

The product term in this repo is `sandbox`.

That refers to the persistent Linux environment the user works inside.

## Security Model

Deployery intentionally preserves a powerful guest environment:

- the sandbox user can use `sudo`
- packages, services, browsers, and desktop apps run inside the persistent
  guest environment
- the guest should be treated as untrusted

The protection boundary is therefore outside the guest:

- host protection comes from the outer container/runtime boundary
- `runsc` is the recommended production runtime on supported hosts
- plain `runc` mode prioritizes desktop compatibility over strict seccomp
  filtering
- NVIDIA GPU support is currently centered on the plain `runc` profile for AI
  workloads
- persistent system paths keep installed software and configuration, while
  compositor/runtime scratch state remains ephemeral
