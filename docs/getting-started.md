# Getting Started

## Prerequisites

- Node.js 22+
- `pnpm`
- Docker Desktop using Linux containers

## Install Dependencies

```bash
pnpm install
```

## Build The Repo

```bash
pnpm build
```

This builds the monorepo packages on your machine. It is the fastest way to
check whether the source code currently compiles.

## Run Deployery

```bash
docker compose up --build
```

Then open:

```text
http://localhost:3131
```

## What Happens On First Boot

On first boot, the container:

- creates the persistent sandbox root filesystem
- installs the managed desktop assets
- starts `code-server` inside the sandbox
- starts the Deployery API on the public port

The first boot is slower than later restarts because the sandbox rootfs and
managed runtime files need to be initialized.

## Stopping Or Resetting

Stop the app:

```bash
docker compose down
```

Stop and delete persistent sandbox data:

```bash
docker compose down -v
```

Be careful with `down -v`. It removes the persistent Docker volume, including
the sandbox filesystem and SQLite state.
