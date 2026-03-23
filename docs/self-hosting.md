# Self-Hosting

Deployery runs as a single Docker image. You can deploy it on any Linux machine
that can run Docker - a VPS, a home server, or your laptop.

## Requirements

- Docker (with Compose) - [install guide](https://docs.docker.com/engine/install/)
- 2 GB RAM minimum (4 GB recommended)
- Linux host (Ubuntu 22.04+ recommended)

## Quick Start

Download the compose file and start:

```bash
curl -O https://raw.githubusercontent.com/OWNER/deployery/main/docker-compose.hub.yml
docker compose -f docker-compose.hub.yml up -d
```

Open `http://localhost:3131` in your browser.

That's it for local or IP-only access. For a real domain with HTTPS, see below.

---

## HTTPS and Custom Domain

Set `DEPLOYERY_DOMAIN` to your domain before starting. Deployery uses
[Caddy](https://caddyserver.com) as a reverse proxy - it fetches a
Let's Encrypt TLS certificate automatically on first request.

```bash
DEPLOYERY_DOMAIN=deploy.example.com docker compose -f docker-compose.hub.yml up -d
```

**Before starting**, point a DNS A record at your server:

```
deploy.example.com  →  <your server IP>
```

DNS changes can take a few minutes to propagate. Caddy will fail to issue a
certificate if the DNS record isn't live yet. Once DNS resolves, Caddy retries
automatically.

---

## VPS Deployment

Deployery runs on any Ubuntu 22.04+ VPS. Below are the steps for the most
common providers.

### Hetzner Cloud

1. Create a server - Ubuntu 24.04, CX22 (2 vCPU / 4 GB) or larger.
2. SSH in and install Docker:
   ```bash
   curl -fsSL https://get.docker.com | sh
   ```
3. Open ports 80 and 443 in the Hetzner Cloud Firewall (under your project →
   Firewalls → Add Rule → Inbound → TCP 80 and 443).
4. Follow the [Quick Start](#quick-start) above.

### DigitalOcean

1. Create a Droplet - Ubuntu 24.04. Pick the **Docker** Marketplace image to
   skip the install step, or use any Ubuntu image and install Docker manually.
2. Open ports 80 and 443 in the DigitalOcean Cloud Firewall (Networking →
   Firewalls).
3. Follow the [Quick Start](#quick-start) above.

### Other providers

Any provider that gives you a root Ubuntu VM works. The only requirements are:
- Docker installable
- Inbound ports 80 and 443 reachable

---

## Updating

Pull the latest images and restart:

```bash
docker compose -f docker-compose.hub.yml pull
docker compose -f docker-compose.hub.yml up -d
```

Your data (sandbox filesystem, SQLite state) lives in Docker volumes and is
not affected by updates.

---

## Resetting

Stop the app:

```bash
docker compose -f docker-compose.hub.yml down
```

Stop and wipe all persistent data (sandbox filesystem, database):

```bash
docker compose -f docker-compose.hub.yml down -v
```

`down -v` is destructive - it deletes the sandbox rootfs and all workflow
state. There is no recovery after this.

---

## gVisor (Strong Isolation)

By default, the sandbox runs under the standard Docker runtime (`runc`). For
stronger isolation - recommended when running untrusted or autonomous AI agents
- you can enable [gVisor](https://gvisor.dev), a user-space kernel that
intercepts all syscalls made by code running inside the sandbox.

gVisor is a **host-level runtime**. The Deployery image itself requires no
changes. You install it once on the host and opt in with one line in the
compose file.

### When to use it

| Deployment | Recommendation |
|---|---|
| Personal use, trusted agents | `runc` (default) is fine |
| Shared instance, autonomous agents | Enable gVisor |
| PaaS (Railway, Render) | Not available - custom runtimes unsupported |
| VPS (Hetzner, DigitalOcean) | Supported, recommended for multi-user |

### Install gVisor on the host

```bash
curl -fsSL https://gvisor.dev/archive.key \
  | sudo gpg --dearmor -o /usr/share/keyrings/gvisor-archive-keyring.gpg

echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/gvisor-archive-keyring.gpg] \
  https://storage.googleapis.com/gvisor/releases release main" \
  | sudo tee /etc/apt/sources.list.d/gvisor.list

sudo apt-get update && sudo apt-get install -y runsc
sudo runsc install
sudo systemctl reload docker
```

### Enable it in the compose file

Open `docker-compose.hub.yml` and uncomment `runtime: runsc` in the `sandbox`
service:

```yaml
sandbox:
  image: ghcr.io/OWNER/deployery:latest
  runtime: runsc   # ← uncomment this line
  cap_add:
    - SYS_ADMIN
```

Then restart:

```bash
docker compose -f docker-compose.hub.yml up -d
```

To verify gVisor is active, run inside the container:

```bash
docker exec -it deployery-sandbox-1 cat /proc/version
# Should contain "gVisor"
```

### Platform notes

gVisor uses the **Systrap** platform by default (since 2023). Systrap does not
require nested KVM or hardware virtualization - it works on standard Hetzner
and DigitalOcean VMs.

---

## Environment Variables

| Variable | Default | Description |
|---|---|---|
| `DEPLOYERY_DOMAIN` | `localhost` | Domain for HTTPS. Leave unset for plain HTTP. |

All other configuration is internal to the container and does not need to be
changed for a standard deployment.

---

## Building from Source

If you want to run from the Git repository rather than published images:

```bash
git clone https://github.com/OWNER/deployery
cd deployery
docker compose up --build
```

This builds both the sandbox image and Caddy locally. The first build takes
several minutes - it bootstraps a full Ubuntu environment inside the image.

Development access is at `http://localhost` (port 80 via Caddy) or
`http://localhost:3131` (sandbox API directly, bypassing Caddy).
