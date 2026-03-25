# Deployery

Deployery is a self-hosted sandbox runtime that boots directly into `code-server`
and persists a Linux working environment, including user-installed system
packages, across restarts.

## Docs

Basic project documentation lives in `./docs`:

- `docs/architecture.md`
- `docs/runsc-testing.md`
- `docs/self-hosting.md`
- `docs/variables.md`

## Workspace Layout

```text
apps/api                  HTTP API, workflow host, and code-server front proxy
packages/persistence      Drizzle schema and persistence adapters
packages/workflow-engine  Workflow scheduling and execution primitives
packages/workflow-schema  Shared manifest types and validation
packages/cli              Deployery workflow CLI
packages/extension-desktop VS Code desktop extension
docker/image              Docker build and runtime assets
```

## Getting Started

```bash
pnpm install
pnpm build
pnpm dev
```

The sandbox persists key system paths directly (`/usr`, `/etc`, `/var`, `/opt`,
and `/home/user`) and serves:

- `http://localhost:3131/` -> `code-server`
- `http://localhost:3131/api/*` -> Deployery API

The default plain-Docker profile is:

```bash
docker compose up -d --build
```

For stronger host isolation on supported Linux hosts, use the same Compose file
with `runsc`:

```bash
DEPLOYERY_SANDBOX_RUNTIME=runsc DEPLOYERY_SANDBOX_ISOLATION_MODE=hardened-runsc docker compose up -d --build
```

For NVIDIA-backed AI workloads on plain Docker / `runc`:

```bash
DEPLOYERY_SANDBOX_GPU_COUNT=all docker compose up -d --build
```

## Current Scope

- Full repo skeleton and package wiring
- SQLite by default, optional PostgreSQL
- API and CLI scaffolding
- Docker and persistent system-path bootstrap
- Preserved desktop assets and extension runtime support

The workflow engine foundation is in place, but deeper production execution
semantics can be extended on top of this structure.
