# Running Deployery

This guide covers every way to run Deployery, from the simplest local setup to
hardened production deployments with GPU support.

## Requirements

- Docker Engine with Compose plugin
- Linux host (native install, VM, or VPS)
- 2 GB RAM minimum, 4 GB recommended

Install Docker if needed:
https://docs.docker.com/engine/install/

After installing, add yourself to the `docker` group so you don't need `sudo`
for every command:

```bash
sudo usermod -aG docker "$USER"
```

Log out and back in (or run `newgrp docker`) for the group change to apply.

## Quick Start

From the repo root:

```bash
pnpm docker:up
```

Or equivalently:

```bash
docker compose up --build
```

Open `http://localhost` in your browser. Caddy proxies port 80 to the sandbox.

To run in the background:

```bash
docker compose up -d --build
```

To stop:

```bash
pnpm docker:down
```

To stop and delete all persistent data:

```bash
pnpm docker:down:clean
```

## Deployment Modes

Deployery ships as a single Docker image with four deployment modes controlled
by compose overlays:

| Mode | Command | Runtime | GPU | Host setup |
|------|---------|---------|-----|------------|
| Regular | `pnpm docker:up` | `runc` | No | None |
| GPU | `pnpm docker:up:gpu` | `runc` | Yes | NVIDIA toolkit |
| Hardened | `pnpm docker:up:hardened` | `runsc` | No | gVisor |
| Hardened + GPU | `pnpm docker:up:hardened:gpu` | `runsc-gpu` | Yes | gVisor + NVIDIA |

## Package Script Reference

Root-level `pnpm` scripts:

| Category | Command | Purpose |
|------|---------|---------|
| Docker | `pnpm docker:up` | Start regular mode |
| Docker | `pnpm docker:up:clean` | Recreate regular mode after deleting volumes |
| Docker | `pnpm docker:up:gpu` | Start GPU mode |
| Docker | `pnpm docker:up:gpu:clean` | Recreate GPU mode after deleting volumes |
| Docker | `pnpm docker:up:hardened` | Start hardened mode |
| Docker | `pnpm docker:up:hardened:clean` | Recreate hardened mode after deleting volumes |
| Docker | `pnpm docker:up:hardened:gpu` | Start hardened GPU mode |
| Docker | `pnpm docker:up:hardened:gpu:clean` | Recreate hardened GPU mode after deleting volumes |
| Docker | `pnpm docker:build` | Build the Compose images without starting containers |
| Docker | `pnpm docker:build:clean` | Delete volumes, then rebuild the Compose images |
| Docker | `pnpm docker:logs` | Follow sandbox logs |
| Docker | `pnpm docker:down` | Stop the stack |
| Docker | `pnpm docker:down:clean` | Stop the stack and delete volumes |
| Workspace | `pnpm dev` | Run the API development task via Turborepo |
| Workspace | `pnpm build` | Run all build tasks |
| Workspace | `pnpm check` | Run linting, type-checking, and coverage tests |
| Workspace | `pnpm lint` | Run lint tasks |
| Workspace | `pnpm check-types` | Run type-check tasks |
| Workspace | `pnpm test` | Run package test tasks |
| Workspace | `pnpm test:run` | Run Vitest with coverage |
| Workspace | `pnpm test:unit` | Run unit-test tasks |
| Workspace | `pnpm test:integration` | Run integration-test tasks |
| Workspace | `pnpm format` | Format TS, TSX, JS, MJS, JSON, YML, and YAML files |

All four modes use the same image. The overlays only change the container
runtime and device reservations.

### Regular (recommended default)

```bash
pnpm docker:up
```

Uses the standard Docker runtime (`runc`). A custom seccomp profile blocks
kernel exploit syscalls (`bpf`, `io_uring`, `keyctl`, etc.) while allowing
everything a developer needs: `sudo`, `apt install`, Chrome, desktop apps,
Node.js, Python, and anything else.

This is what most users should run. It works on any host, any PaaS, any VPS
with zero extra setup.

### Hardened

```bash
pnpm docker:up:hardened
```

Uses gVisor (`runsc`), which intercepts every syscall through a userspace
kernel. Even if a kernel vulnerability exists, the attack hits gVisor first, not
the host kernel.

Requires host setup (see below). Recommended for production hosts running
untrusted AI agents where you control the infrastructure.

## Verify It's Working

```bash
curl http://localhost:3131/healthz
curl http://localhost:3131/healthz/readiness
curl http://localhost:3131/api/v1/runtime
```

Or check the logs:

```bash
pnpm docker:logs
```

Success looks like:

- `/healthz` returns `status: "ok"`
- `/healthz/readiness` returns `ready`
- `/api/v1/runtime` reports the active runtime and isolation mode
- sandbox logs show the runtime summary with no crash loops

## GPU Setup

GPU support requires the NVIDIA Container Toolkit on the host. This applies to
both regular and hardened GPU modes.

### 1. Verify the host GPU

```bash
nvidia-smi
```

If this fails, fix the NVIDIA driver first.

### 2. Install NVIDIA Container Toolkit

```bash
curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
  sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -fsSL https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#' | \
  sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list > /dev/null
sudo apt-get update
sudo apt-get install -y nvidia-container-toolkit
sudo nvidia-ctk runtime configure --runtime=docker
sudo systemctl restart docker
```

### 3. Verify Docker GPU access

```bash
docker run --rm --gpus all ubuntu nvidia-smi -L
```

This must work before starting Deployery with GPU.

### 4. Start Deployery with GPU

All GPUs:

```bash
pnpm docker:up:gpu
```

Single GPU:

```bash
DEPLOYERY_SANDBOX_GPU_COUNT=1 pnpm docker:up:gpu
```

Specific GPU by index:

```bash
DEPLOYERY_SANDBOX_NVIDIA_VISIBLE_DEVICES=0 pnpm docker:up:gpu
```

## Hardened Mode Setup (gVisor)

### 1. Install `runsc`

```bash
curl -fsSL https://gvisor.dev/archive.key | \
  sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg
echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] https://storage.googleapis.com/gvisor/releases release main" | \
  sudo tee /etc/apt/sources.list.d/gvisor.list > /dev/null
sudo apt-get update
sudo apt-get install -y runsc
sudo runsc install
sudo systemctl restart docker
```

### 2. Verify Docker sees the runtime

```bash
docker info --format '{{json .Runtimes}}'
```

You should see a `runsc` entry.

### 3. Smoke test

```bash
docker run --rm --runtime=runsc hello-world
docker run --rm --runtime=runsc ubuntu uname -a
```

If these fail, fix the host gVisor setup before starting Deployery.

### 4. Start Deployery hardened

```bash
pnpm docker:up:hardened
```

### Note on Node.js compatibility

gVisor's clock implementation can return non-monotonic timestamps, which crashes
Node.js. Deployery includes an `LD_PRELOAD` shim (`monotonic-shim.c`) that
clamps `clock_gettime` to never go backwards. This is loaded automatically in
hardened mode. If you see clock-related assertion crashes in the logs, the shim
is not being loaded — check the entrypoint.

## Hardened + GPU Setup

This combines gVisor with NVIDIA GPU access. Complete both the GPU setup and
the hardened mode setup above first, then add the GPU runtime alias:

```bash
sudo runsc install --runtime runsc-gpu -- --nvproxy
sudo systemctl restart docker
```

Verify both runtimes are registered:

```bash
docker info --format '{{json .Runtimes}}'
```

Check driver compatibility:

```bash
runsc nvproxy list-supported-drivers
```

If your driver is not listed, the `runsc` and driver versions are incompatible.

Smoke test:

```bash
docker run --rm --runtime=runsc-gpu --gpus all ubuntu nvidia-smi -L
```

Start Deployery:

```bash
pnpm docker:up:hardened:gpu
```

## Common Problems

### Permission denied on Docker socket

Add yourself to the `docker` group and re-login:

```bash
sudo usermod -aG docker "$USER"
newgrp docker
```

### `unknown or invalid runtime name: runsc`

gVisor is not registered with Docker:

```bash
sudo runsc install
sudo systemctl restart docker
```

### `unknown or invalid runtime name: runsc-gpu`

The GPU runtime alias is not registered:

```bash
sudo runsc install --runtime runsc-gpu -- --nvproxy
sudo systemctl restart docker
```

### `could not select device driver "nvidia"`

NVIDIA Container Toolkit is not installed or Docker was not restarted after
configuration. Re-run the GPU setup section.

### `runsc nvproxy list-supported-drivers` does not list your driver

Your NVIDIA driver and `runsc` versions are incompatible. Update one or both.

### Deployery starts but reports the wrong runtime

Check which compose overlay you used and verify the environment:

```bash
docker compose logs sandbox --tail=20
```

The logs show the isolation mode and runtime on startup.

## Useful Endpoints

- `http://localhost:3131/healthz` — health check
- `http://localhost:3131/healthz/readiness` — readiness probe
- `http://localhost:3131/api/v1/runtime` — active runtime, GPU status

## Compose Files

| File | Purpose |
|------|---------|
| `docker-compose.yml` | Base (regular mode) |
| `docker-compose.gpu.yml` | GPU overlay for runc |
| `docker-compose.hardened.yml` | gVisor overlay |
| `docker-compose.hardened-gpu.yml` | gVisor + GPU overlay |
| `docker-compose.hub.yml` | Pre-built images from registry |
