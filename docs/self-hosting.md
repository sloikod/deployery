# Self-Hosting

Deployery runs as a Dockerized sandbox runtime with a persistent root filesystem
and a database-backed workflow engine.

## Requirements

- Docker with Compose
- 2 GB RAM minimum, 4 GB recommended
- Linux host for production deployments

## Local Source Build

If you are running from this repository directly, use the source compose file:

```bash
pnpm install
pnpm build
docker compose up --build
```

Open `http://localhost:3131` after the sandbox finishes booting.

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
docker compose up --build
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

## Resetting Data

Stop the stack:

```bash
docker compose down
```

Delete all persistent data:

```bash
docker compose down -v
```

This removes the sandbox filesystem and the default SQLite database volume data.

## gVisor

The compose files include a commented `runtime: runsc` line for hosts where you
want stronger sandbox isolation with [gVisor](https://gvisor.dev/).
