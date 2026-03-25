# Testing `runsc` and `runsc-gpu`

This guide is for operators who want to validate Deployery on a native Ubuntu
host with:

- `runsc` for stronger container isolation
- `runsc-gpu` for advanced gVisor + NVIDIA experiments

Recommended host shape:

- use a native Linux install or VM where Docker Engine runs directly
- use plain `runc` first to confirm the host works before adding gVisor
- avoid WSL 2 Docker Desktop internals for `runsc` runtime setup
- avoid treating VirtualBox as the primary path for GPU validation

If you are on Windows with a second native Ubuntu install, use that Ubuntu
install for both guides below.

## Before You Start

You need:

- Ubuntu with `sudo`
- Docker Engine with Compose plugin
- this repo checked out on the Linux host

For `runsc-gpu`, you also need:

- an NVIDIA GPU supported by the host driver
- `nvidia-smi` working on the host before Docker is involved
- NVIDIA Container Toolkit configured for Docker

## Guide 1: Test `runsc`

This path validates that Docker can launch containers under gVisor and that
Deployery reports the expected runtime.

### 1. Install Docker Engine

If Docker is not already installed:

```bash
sudo apt-get update
sudo apt-get install -y ca-certificates curl gnupg
sudo install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg | \
  sudo gpg --dearmor -o /etc/apt/keyrings/docker.gpg
sudo chmod a+r /etc/apt/keyrings/docker.gpg
echo \
  "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.gpg] https://download.docker.com/linux/ubuntu \
  $(. /etc/os-release && echo \"$VERSION_CODENAME\") stable" | \
  sudo tee /etc/apt/sources.list.d/docker.list > /dev/null
sudo apt-get update
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker "$USER"
newgrp docker
docker version
docker compose version
```

### 2. Install `runsc`

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

### 3. Verify Docker sees the runtime

```bash
docker info --format '{{json .Runtimes}}'
```

You should see a `runsc` entry in the runtime map.

### 4. Run `runsc` smoke tests

```bash
docker run --rm --runtime=runsc hello-world
docker run --rm --runtime=runsc ubuntu uname -a
```

If these fail, stop here and fix the Docker + gVisor host setup before testing
Deployery.

### 5. Start Deployery under `runsc`

From the repo root:

```bash
docker compose -f docker-compose.yml -f docker-compose.runsc.yml up -d --build
```

You can also use the main compose file directly:

```bash
DEPLOYERY_SANDBOX_RUNTIME=runsc \
DEPLOYERY_SANDBOX_ISOLATION_MODE=hardened-runsc \
docker compose up -d --build
```

### 6. Verify the Deployery runtime

```bash
curl http://localhost:3131/healthz
curl http://localhost:3131/healthz/readiness
curl http://localhost:3131/api/v1/runtime
docker compose logs sandbox --tail=100
```

Success looks like:

- `/healthz` returns `status: "ok"`
- `/healthz/readiness` becomes `ready`
- `/api/v1/runtime` reports `runtime: "runsc"`
- sandbox logs include the selected runtime and isolation mode

### 7. Tear down

```bash
docker compose down
```

If you want a full reset of persistent data:

```bash
docker compose down -v
```

## Guide 2: Test `runsc-gpu`

This is the advanced path. Validate the plain NVIDIA Docker path first, then
add gVisor GPU support on top.

### 1. Verify the host GPU works

```bash
nvidia-smi
```

If `nvidia-smi` fails on the host, do not continue until the Ubuntu NVIDIA
driver is fixed.

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

### 3. Verify plain Docker GPU access

```bash
docker run --rm --gpus all ubuntu nvidia-smi -L
```

This must work before you try `runsc-gpu`.

### 4. Install `runsc` and register the GPU runtime

If you already completed Guide 1, `runsc` is already installed. Add the GPU
runtime alias:

```bash
sudo runsc install --runtime runsc-gpu -- --nvproxy
sudo systemctl restart docker
docker info --format '{{json .Runtimes}}'
```

You should now see both `runsc` and `runsc-gpu`.

### 5. Check driver compatibility

```bash
runsc nvproxy list-supported-drivers
```

If your installed NVIDIA driver is not supported by the current `runsc`
release, stop here and fix that mismatch first.

### 6. Run `runsc-gpu` smoke tests

```bash
docker run --rm --runtime=runsc-gpu --gpus all ubuntu nvidia-smi -L
```

If you want a second smoke test with CUDA libraries available, use an NVIDIA
CUDA base image that matches your host setup.

### 7. Start Deployery under `runsc-gpu`

From the repo root:

```bash
docker compose -f docker-compose.yml -f docker-compose.runsc-gpu.yml up -d --build
```

You can also use environment variables directly:

```bash
DEPLOYERY_SANDBOX_RUNTIME=runsc-gpu \
DEPLOYERY_SANDBOX_ISOLATION_MODE=hardened-runsc-gpu \
DEPLOYERY_SANDBOX_GPU_COUNT=all \
docker compose up -d --build
```

If you want a single GPU:

```bash
DEPLOYERY_SANDBOX_RUNTIME=runsc-gpu \
DEPLOYERY_SANDBOX_ISOLATION_MODE=hardened-runsc-gpu \
DEPLOYERY_SANDBOX_GPU_COUNT=1 \
docker compose up -d --build
```

If you want a specific GPU by index or UUID:

```bash
DEPLOYERY_SANDBOX_RUNTIME=runsc-gpu \
DEPLOYERY_SANDBOX_ISOLATION_MODE=hardened-runsc-gpu \
DEPLOYERY_SANDBOX_GPU_COUNT=all \
DEPLOYERY_SANDBOX_NVIDIA_VISIBLE_DEVICES=0 \
docker compose up -d --build
```

### 8. Verify the Deployery runtime and GPU request

```bash
curl http://localhost:3131/healthz
curl http://localhost:3131/healthz/readiness
curl http://localhost:3131/api/v1/runtime
docker compose logs sandbox --tail=100
```

Success looks like:

- `/healthz` returns `status: "ok"`
- `/healthz/readiness` becomes `ready`
- `/api/v1/runtime` reports `runtime: "runsc-gpu"`
- `/api/v1/runtime` shows `gpu.requested: true`
- `/api/v1/runtime` shows the requested count and visible devices

### 9. Tear down

```bash
docker compose down
```

For a full volume reset:

```bash
docker compose down -v
```

## Common Failure Points

### `unknown or invalid runtime name: runsc`

Docker does not know about the `runsc` runtime yet. Re-run:

```bash
sudo runsc install
sudo systemctl restart docker
docker info --format '{{json .Runtimes}}'
```

### `unknown or invalid runtime name: runsc-gpu`

Docker does not know about the GPU runtime alias yet. Re-run:

```bash
sudo runsc install --runtime runsc-gpu -- --nvproxy
sudo systemctl restart docker
docker info --format '{{json .Runtimes}}'
```

### `docker run --gpus all ...` fails before gVisor is involved

This is a host NVIDIA or NVIDIA Container Toolkit problem, not a Deployery
problem. Fix the plain Docker GPU path first.

### `runsc nvproxy list-supported-drivers` does not include your driver

Your NVIDIA driver and `runsc` build are incompatible for `runsc-gpu`. Change
the driver version, `runsc` version, or both.

### Deployery starts but reports the wrong runtime

Check:

- the compose override you used
- the `DEPLOYERY_SANDBOX_RUNTIME` value
- the `DEPLOYERY_SANDBOX_ISOLATION_MODE` value
- `docker compose logs sandbox --tail=100`

## Repo-Specific Verification Targets

Deployery exposes the active runtime here:

- `http://localhost:3131/healthz`
- `http://localhost:3131/healthz/readiness`
- `http://localhost:3131/api/v1/runtime`

Useful files in this repo:

- `docker-compose.yml`
- `docker-compose.runsc.yml`
- `docker-compose.runsc-gpu.yml`
- `docs/self-hosting.md`

## Source of Truth

When host setup details differ from this repo guide, prefer the upstream docs:

- gVisor install and Docker quick start
- gVisor GPU support and `nvproxy` compatibility
- NVIDIA Container Toolkit installation docs
