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

For a step-by-step guide covering all deployment modes (regular, hardened, GPU),
see [`docs/running.md`](./running.md).

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

- regular mode
  - plain Docker with the `runc` runtime
  - a custom seccomp profile blocks kernel exploit syscalls while allowing all
    normal usage including Chrome, Electron, and desktop apps
  - works on any host, any PaaS, any VPS with zero extra setup
- hardened mode
  - Docker with `runsc` (gVisor)
  - intercepts every syscall through a userspace kernel for defense in depth
  - recommended for production hosts that execute untrusted user workloads or
    rogue agents
  - requires gVisor installed on the host

The sandbox remains intentionally powerful in both modes. Users can install
packages, run `sudo`, and modify the full persistent guest `/`. Hardening is
about containing the sandbox from the outside, not restricting it from within.

### Runtime selection

Plain Docker / `runc` is the default:

```bash
pnpm docker:up
```

Equivalent raw Compose command:

```bash
docker compose up --build
```

To switch to gVisor on a host that has `runsc` configured:

```bash
pnpm docker:up:hardened
```

Equivalent raw Compose command:

```bash
docker compose -f docker-compose.yml -f docker-compose.hardened.yml up --build
```

The runtime mode is surfaced at:

- `/healthz`
- `/healthz/readiness`
- `/api/v1/runtime`

## GPU Support

Deployery now supports opt-in NVIDIA GPU access for AI and compute workloads in
the default plain-Docker / `runc` profile.

Recommended shape today:

- use `runc` for GPU-backed AI workloads
- use `runsc` when host isolation matters more than maximum GPU and desktop
  compatibility
- treat `runsc` + GPU as an advanced operator path, not the primary supported
  GPU path

### Host setup

On the Linux host:

1. Install an NVIDIA driver supported by your GPU.
2. Install the NVIDIA Container Toolkit.
3. Configure Docker for NVIDIA containers:

```bash
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

4. Verify the host setup before starting Deployery:

```bash
docker run --rm --gpus all ubuntu nvidia-smi
```

### Start Deployery with GPU access

Expose all GPUs:

```bash
pnpm docker:up:gpu
```

Expose one GPU:

```bash
DEPLOYERY_SANDBOX_GPU_COUNT=1 \
pnpm docker:up:gpu
```

Choose specific devices by index or UUID:

```bash
DEPLOYERY_SANDBOX_GPU_COUNT=all \
DEPLOYERY_SANDBOX_NVIDIA_VISIBLE_DEVICES=0 \
pnpm docker:up:gpu
```

By default Deployery requests `compute,utility` NVIDIA driver capabilities,
which is the right baseline for CUDA, PyTorch, model inference, and tools such
as `nvidia-smi`.

The active GPU request is exposed at `/api/v1/runtime`.

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
DEPLOYERY_DOMAIN=deploy.example.com pnpm docker:up
```

Point your DNS A record at the host first. Caddy will request a Let's Encrypt
certificate automatically once the domain resolves publicly.

For local development, keep the default `DEPLOYERY_DOMAIN=http://localhost` so
Caddy stays on plain HTTP instead of generating a localhost certificate.

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

- use `runsc` where available for defense in depth
- the default `runc` mode uses a custom seccomp profile that blocks kernel
  exploit syscalls while keeping desktop apps working
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

`docker-compose.hardened.yml` remains available as a convenience override, but the
primary deployment path is the main Compose file with
`DEPLOYERY_SANDBOX_RUNTIME=runsc`.

### Advanced: `runsc` + GPU

This is intentionally not the primary documented GPU path.

If you want GPU access under gVisor, the expectation is that you are an
advanced operator managing the host runtime yourself.

Deployery-side support is already present:

- GPU requests are still controlled with `DEPLOYERY_SANDBOX_GPU_COUNT`
- the sandbox runtime string can point at any Docker runtime name
- this repo ships an optional [docker-compose.hardened-gpu.yml](../docker-compose.hardened-gpu.yml) override that expects a host runtime named `runsc-gpu`

Host-side requirements are where the real complexity lives:

1. The host must already support the plain Docker / NVIDIA path.
2. The installed `runsc` version must support your NVIDIA driver:

```bash
runsc nvproxy list-supported-drivers
```

3. The Docker daemon must expose a runtime that launches `runsc` with GPU
   support enabled via `--nvproxy`.

The gVisor GPU docs are the source of truth here. Deployery does not try to
track or abstract specific `runsc` / driver compatibility combinations for you.

If the host runtime is set up correctly, advanced users can use:

```bash
pnpm docker:up:hardened:gpu
```

or with environment variables and the GPU overlay:

```bash
DEPLOYERY_SANDBOX_RUNTIME=runsc-gpu \
DEPLOYERY_SANDBOX_ISOLATION_MODE=hardened-runsc-gpu \
DEPLOYERY_SANDBOX_GPU_COUNT=all \
pnpm docker:up:gpu
```

The main recommendation still stands:

- use `runc` for the primary GPU path
- use `runsc` + GPU only when you know you need it and are prepared to manage
  the host-side complexity
