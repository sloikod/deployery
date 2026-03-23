# Architecture

## Overview

Deployery is a self-hosted sandbox runtime centered around `code-server`.

The current design is:

- one Docker image
- one public HTTP port
- one persistent sandbox filesystem
- one API app
- one SQLite database

## Runtime Shape

The main pieces are:

- `apps/api`
  - public HTTP server
  - workflow API surface
  - health and metrics endpoints
  - reverse proxy to private `code-server`
- `code-server`
  - runs inside the sandbox root filesystem
  - is exposed through the API proxy on the public port
- SQLite via Drizzle
  - stores workflow and runtime state
- persistent sandbox rootfs
  - stored under `/var/lib/deployery/sandbox-rootfs`
  - intended to behave like a full Linux environment for the user

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

That refers to the persistent Linux environment the user works inside, not the
old E2B multi-sandbox control-plane model.
