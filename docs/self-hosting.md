# Self-Hosting

Deployery runs as a Dockerized sandbox runtime with persistent system
directories and a database-backed workflow engine.

## Requirements

- Docker with Compose
- 2 GB RAM minimum, 4 GB recommended
- Linux host for production deployments

For production hardening on supported hosts, install
[`runsc` / gVisor](https://gvisor.dev/docs/user_guide/quick_start/docker/)
and enable it in Docker before starting Deployery.

## Local Source Build

If you are running from this repository directly, use the source compose file:

```bash
pnpm install
pnpm build
pnpm dev
```

Open `http://localhost:3131` after the sandbox finishes booting.

## Deployment Modes

Deployery supports two runtime profiles through the same Compose file:

- compatibility mode
  - plain Docker with the `runc` runtime
  - seccomp defaults to `unconfined` so Chromium, Electron, and similar
    desktop apps can use their own namespace sandboxing
  - easiest to self-host
  - useful for local development and broad compatibility
- hardened mode
  - Docker with `runsc`
  - recommended for production hosts that execute untrusted user workloads or
    rogue agents

The sandbox remains intentionally powerful in both modes. Users can install
packages, run `sudo`, and modify the full persistent guest `/`. Hardening is
about containing the sandbox from the outside, not restricting it from within.

### Runtime selection

Plain Docker / `runc` is the default:

```bash
docker compose up -d --build
```

To switch the same Compose file to gVisor on a host that has `runsc`
configured:

```bash
DEPLOYERY_SANDBOX_RUNTIME=runsc \
DEPLOYERY_SANDBOX_ISOLATION_MODE=hardened-runsc \
docker compose up -d --build
```

The runtime mode is surfaced at:

- `/healthz`
- `/healthz/readiness`
- `/api/v1/runtime`

## Sandbox Persistence

Deployery persists the sandbox directly through mounted system directories:

- `/usr`
- `/etc`
- `/var`
- `/opt`
- `/home/user`

This keeps `apt` installs, most system configuration changes, desktop app
installs, and user home state across restarts.

Runtime-only paths such as `/tmp` and `/run` are intentionally ephemeral.

Legacy deployments that used `/var/lib/deployery/sandbox-rootfs` are migrated
forward automatically on first boot into the flattened persistent layout.

## Database Modes

Deployery follows the n8n-style default of local SQLite with an optional switch
to PostgreSQL.

### SQLite default

No extra configuration is required. The default compose file writes SQLite data
to `/var/lib/deployery/data/deployery.sqlite` inside the persistent volume.

### PostgreSQL optional

Set the database environment variables before starting:

```bash
DB_TYPE=postgres
DB_POSTGRESDB_CONNECTION_URL=postgresql://deployery:secret@db:5432/deployery
pnpm dev
```

You can also provide the Postgres host, port, database, user, and password as
separate `DB_POSTGRESDB_*` variables instead of a connection URL.

## HTTPS and Custom Domain

Set `DEPLOYERY_DOMAIN` to a real domain before starting Caddy if you want
automatic HTTPS:

```bash
DEPLOYERY_DOMAIN=deploy.example.com docker compose up -d --build
```

Point your DNS A record at the host first. Caddy will request a Let's Encrypt
certificate automatically once the domain resolves publicly.

## Published Images

`docker-compose.hub.yml` is intended for published images. Replace the `OWNER`
placeholder with your GitHub org or username before using it, or export custom
image names in your environment first.

## Threat Model

Deployery is designed around a hostile-sandbox assumption:

- sandbox users and agents are not trusted
- they are allowed to use `sudo` inside the guest
- host protection comes from the container/runtime boundary, not guest-level
  restrictions

Recommended host posture:

- use `runsc` where available
- understand that plain `runc` mode intentionally relaxes seccomp to keep
  general-purpose desktop app sandboxes working
- keep Deployery bound behind Caddy or another reverse proxy
- avoid exposing internal sandbox services directly
- do not mount the Docker socket into Deployery
- size the host for browser and desktop workloads

## Resetting Data

Stop the stack:

```bash
docker compose down
```

Delete all persistent data:

```bash
docker compose down -v
```

This removes the persisted system directories and the default SQLite database
volume data.

## gVisor

`docker-compose.runsc.yml` remains available as a convenience override, but the
primary deployment path is the main Compose file with
`DEPLOYERY_SANDBOX_RUNTIME=runsc`.
