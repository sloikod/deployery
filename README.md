# Deployery

Deployery is a self-hosted sandbox runtime that boots directly into `code-server`
and persists a full Linux sandbox filesystem across restarts.

## Docs

Basic project documentation lives in `./docs`:

- `docs/getting-started.md`
- `docs/architecture.md`
- `docs/commands.md`
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

The container initializes a persistent sandbox root filesystem at
`/var/lib/deployery/sandbox-rootfs` and serves:

- `http://localhost:3131/` -> `code-server`
- `http://localhost:3131/api/*` -> Deployery API

## Current Scope

- Full repo skeleton and package wiring
- SQLite by default, optional PostgreSQL
- API and CLI scaffolding
- Docker and sandbox rootfs bootstrap
- Preserved desktop assets and extension runtime support

The workflow engine foundation is in place, but deeper production execution
semantics can be extended on top of this structure.
