# Deployery Product Image Plan

## Purpose

Deployery should ship as a single Docker image that can run on platforms with:

- one container
- one persistent volume
- one public HTTP port
- no Docker Compose requirement

The first product surface is a browser-accessible `code-server` instance. The image must preserve:

- installed packages
- editor extensions
- user files
- user config

across restarts and image redeploys, without asking the user to understand mount boundaries.

This document is the implementation plan and terminology reference for that image. It is written to stand alone without requiring chat history.

## Host Compatibility

### Confirmed fit

- Render web services with persistent disks
- Railway services with a volume
- DigitalOcean Droplets

### Not a first-class target

- DigitalOcean App Platform

Reason: the product requires a durable filesystem contract. Render and Railway both support a single persistent mount but make the rest of the filesystem ephemeral. Droplets are ordinary Linux VMs, so the same image can run there with normal Docker volume mounting.

## Underlying Linux System

Deployery is **not** a NixOS container.

The planned base is:

- `debian:bookworm-slim`

The planned package/runtime model is:

- regular Debian userspace
- single-user Nix install
- standalone Home Manager

This is important because the official Nix docs treat multi-user Nix on Linux as a `systemd`-oriented setup. That is a poor match for Render and Railway style containers. The cleaner fit here is single-user Nix owned by the runtime user.

## Supervisor Strategy

Deployery should use:

- `supervisord`

Reason:

- more intuitive for contributors
- strong enough for the actual need today
- good fit for "keep code-server alive and restart it if it dies"
- good fit for adding API and DB later without bringing in a more exotic init system

The implementation must still avoid a giant ad hoc entrypoint script. The boot path should be split into:

- one small idempotent filesystem/init step
- one supervised setup service
- one supervised long-running main service

## Persistent Filesystem Model

The product should assume exactly one durable mount:

- `/deployery`

Everything else in the container is replaceable at image update time.

### Durable paths

- `/deployery/home/user`
  - durable user home backing store
- `/deployery/nix`
  - durable Nix store backing path
- `/deployery/instance.json`
  - small Deployery bookkeeping file for setup/version/migration data

### Runtime-facing paths

- `/home/user`
  - presented as the real home directory
- `/nix`
  - presented where Nix expects it

### Immutable image-owned paths

- `/usr/local/share/deployery`
  - immutable product-owned configuration and assets shipped in the image
- `/usr/local/libexec/deployery`
  - internal helper programs and shared shim logic

These paths come from the image itself, not from `/deployery`. The Docker build copies product-owned files into `/usr/local/share/deployery` and `/usr/local/libexec/deployery`. The persistent volume mounted at `/deployery` is only for durable runtime data.

### Why `/nix` still exists

Nix expects its normal store path. On platforms where the only durable mount is `/deployery`, the clean plan is:

- mount the volume at `/deployery`
- keep durable Nix contents under `/deployery/nix`
- project `/nix` to `/deployery/nix` during boot

That projection can be done with a symlink in the container filesystem. This keeps the host/platform contract simple while preserving the normal Nix path inside the running system.

### How packages and their data persist

Package payloads persist in the Nix store:

- `/deployery/nix/store`

User-level package references and user data persist in home:

- `/deployery/home/user/.config`
- `/deployery/home/user/.local`
- `/deployery/home/user/.cache`
- `/deployery/home/user/.local/share/code-server`
- `/deployery/home/user/.config/code-server`

So the persistence story is split cleanly:

- package binaries and derivation outputs persist in the durable Nix store
- package configuration, extensions, caches, and user data persist in the durable home

## Home Manager Model

The user-editable Home Manager file should remain standard:

- `~/.config/home-manager/home.nix`

Deployery should go full flakes.

The cleanest flake-based shape is:

- Deployery-managed flake:
  - `~/.config/home-manager/flake.nix`
- Deployery-managed flake lock:
  - `~/.config/home-manager/flake.lock`
- user-owned standard file:
  - `~/.config/home-manager/home.nix`

The user-owned `home.nix` remains a normal Home Manager module file. The managed `flake.nix` pins nixpkgs and Home Manager exactly and wires the standard `home.nix` into the managed evaluation.

Deployery may create these files if they do not exist. After that:

- `home.nix` is user-owned and must not be auto-overwritten
- `flake.nix` is Deployery-managed, should not be user-edited, and is overwritten unconditionally on boot from the image-owned managed template
- `flake.lock` is Deployery-managed, should not be user-edited, and is overwritten unconditionally on boot from the image-owned managed lockfile

Recommended exact initial `home.nix` contents:

```nix
{ pkgs, ... }:

{
  home.username = "user";
  home.homeDirectory = "/home/user";
  home.stateVersion = "25.11";

  home.packages = with pkgs; [
  ];
}
```

Recommended exact managed `flake.nix` contents:

```nix
{
  # Managed by Deployery. This file is replaced by image updates.
  # Edit home.nix in this directory instead.
  inputs = {
    nixpkgs.url = "github:NixOS/nixpkgs/nixos-25.11";
    home-manager = {
      url = "github:nix-community/home-manager/release-25.11";
      inputs.nixpkgs.follows = "nixpkgs";
    };
  };

  outputs = { nixpkgs, home-manager, ... }:
    let
      system = "x86_64-linux";
      pkgs = import nixpkgs { inherit system; };
    in {
      homeConfigurations.user = home-manager.lib.homeManagerConfiguration {
        inherit pkgs;
        modules = [
          ./home.nix
          ({ ... }: {
            targets.genericLinux.enable = true;
            programs.home-manager.enable = true;
            home.enableNixpkgsReleaseCheck = true;
          })
        ];
      };
    };
}
```

## Boot Lifecycle

The boot lifecycle should be idempotent and small on **every** boot.

### Every boot

- ensure `/deployery` exists
- ensure `/home/user` points at `/deployery/home/user`
- ensure `/nix` points at `/deployery/nix`
- ensure the runtime user exists
- ensure required directories exist with correct ownership
- ensure the bookkeeping file exists
- start supervised services

### Conditional boot work

- if `~/.config/home-manager/home.nix` does not exist:
  - create the initial standard Home Manager file
- if `~/.config/home-manager/flake.nix` does not exist:
  - create the managed flake in standard Home Manager location
- if `~/.config/home-manager/flake.lock` does not exist:
  - create the managed flake lock in standard Home Manager location
- if code-server config does not exist and `DEPLOYERY_SKIP_SETUP` is not enabled:
  - show the setup flow instead of normal login
- if code-server config does not exist and `DEPLOYERY_SKIP_SETUP` is enabled:
  - allow stock `code-server` startup to create its normal config with generated first-run password
- if the image version changed since last boot:
  - run targeted managed migration work

The goal is:

- tiny idempotent every-boot path
- no sprawling "first boot only" branch
- no giant shell script with every concern jammed into it

## Auth and Security

Deployery auth should protect the **container front door**, not just the code editor.

### What code-server already provides

From the local `../code-server` repo and docs:

- normal config file in `~/.config/code-server/config.yaml`
- `auth: password`
- `hashed-password`
- rate-limited login attempts
- cookie sessions
- configurable login UI strings
- authenticated proxy routes for internal ports
- documented support for external auth in front if needed later

### Best v1 direction

Reuse code-server auth as the primary v1 front door.

Reason:

- it is already there
- it already supports hashed passwords
- it already has rate limiting
- it already has login/session handling
- it already protects proxied internal routes
- it avoids building a parallel auth stack too early

### First-run auth behavior

Deployery should add a tiny one-time `/setup` flow for all deployment targets.

Behavior:

- if no code-server password is configured and `DEPLOYERY_SKIP_SETUP` is not enabled:
  - serve `/setup`
  - collect the first password
  - write an Argon2 `hashed-password` into the normal code-server config location
  - hand off to normal code-server auth
- if `DEPLOYERY_SKIP_SETUP` is enabled:
  - skip `/setup`
  - allow stock code-server config generation
  - document where to retrieve the generated password

This keeps auth centered on code-server while fixing the first-run UX problem on Render, Railway, and similar targets.

The setup page should be plain server-rendered HTML and CSS, not a separate frontend app. It should visually match the website's existing light/dark theme and keep the same calm dashboard feel as the sidebar components in `../deployery-website/components/dashboard/sidebar`, but it does not need the full sidebar UI.

### External auth options for later

`code-server` explicitly documents use with:

- OAuth2 Proxy
- Pomerium
- Cloudflare Access

That means the long-term path stays open for:

- cloud-hosted SSO
- OIDC-based auth
- replacing password login at the deployment edge later

### Password storage

- store only a hashed password
- do not store plaintext
- rely on platform TLS on Render/Railway
- require proper HTTPS termination on Droplets

### Remote setup later

Future non-UI setup is intentionally deferred. A one-time unauthenticated password-setting endpoint is too easy to get wrong. If headless setup is needed later, it should use a deliberate bootstrap token design rather than a naked open endpoint.

### Future API access

For v0 this is sufficient because:

- terminal access inside the browser already sits behind `code-server` auth
- proxied internal HTTP tools already sit behind `code-server` auth

This does not yet solve future machine-facing Deployery API auth, but that should be designed as a first-party product auth layer later instead of being forced into the v0 browser login path.

## What Gets Updated and What Does Not

### Updated by image replacement

- anything under `/usr/local/share/deployery`
- anything under `/usr/local/libexec/deployery`
- supervisor definitions
- immutable Deployery-managed Home Manager templates and setup assets

### Persisted across image replacement

- `/deployery/home/user`
- `/deployery/nix`
- code-server config in home
- code-server extensions in home
- user Home Manager config in home
- managed Home Manager flake files in home
- internal bookkeeping file in `/deployery`

### May be conditionally updated on boot

- bookkeeping file contents
- any explicitly Deployery-owned generated config

### Must not be auto-overwritten

- user `home.nix`
- user files in home
- user editor settings
- user extensions

## Bookkeeping File Naming

The old wording `meta` is rejected.

If this is a single small file, the current better options are:

- `/deployery/instance.json`
- `/deployery/metadata.json`
- `/deployery/system.json`

Current best option:

- `/deployery/instance.json`

Reason:

- concrete
- small and obvious
- matches "one Deployery instance per volume"
- clearly Deployery-owned rather than user-owned

Ownership rule:

- `instance.json` is fully Deployery-managed and must not be hand-edited by the user

Expected contents:

- schema version
- Deployery version

Recommended v0 shape:

```json
{
  "schemaVersion": 1,
  "deployeryVersion": "0.1.0"
}
```

## Repo Layout Direction

The repo should stay monorepo-shaped, but the image-related parts should live close to the image they describe.

Recommended shape:

- `apps/docs`
  - public/internal docs app
- `apps/product`
  - any product-specific TS/JS app code such as setup/bootstrap helper code
- `docker/product`
  - `Dockerfile`
  - supervisor config
  - `rootfs`
  - immutable Deployery files copied into the image

This avoids a floating root-level `nix/` or `runtime-assets/` directory with vague ownership.

## Monorepo Commands Direction

The root command model should evolve toward:

- `pnpm dev`
  - bring up docs and product development together by using workspace filters internally
- `pnpm check`
  - repo-wide checks

Workspace-local scripts should stay in the relevant workspace `package.json` files.

Run one workspace directly with filter syntax:

- `pnpm --filter @deployery/docs dev`
- `pnpm --filter @deployery/product dev`

The root should only provide the small set of common entry commands.

## Shared Shim Message

Blocked command guidance must have one editable source of truth.

The implementation should use:

- one shared message file or helper in `/usr/local/libexec/deployery`
- thin wrappers for:
  - `apt`
  - `apt-get`
  - `nix`

If `nix` is wrapped, it should only intercept `nix profile ...` usage and pass all other `nix` commands through normally.

## Version Pinning

Pinning should have as few sources of truth as possible.

Current preferred split:

- Dockerfile pins the outer Linux image and the Nix installer version
- Home Manager `flake.nix` and `flake.lock` pin the Nix ecosystem inputs and runtime packages

Current pinned values:

- Debian base image:
  - `debian:bookworm-slim`
- Nix installer:
  - `2.34.1`
- nixpkgs input:
  - `github:NixOS/nixpkgs/nixos-25.11`
- Home Manager input:
  - `github:nix-community/home-manager/release-25.11`

Pinning rules:

- Debian base image:
  - pin by tag at minimum
  - digest pinning is optional for v0 and can be added later if stricter reproducibility is needed
- Nix:
  - pin exact installer version in the Docker build
- nixpkgs and Home Manager:
  - pin through the managed flake inputs and committed `flake.lock`
- code-server:
  - install as a Nix-managed runtime package resolved from the locked flake inputs
  - do not install it as a Debian package
  - do not make it a user-owned Home Manager package

This avoids a second hand-maintained manifest like `versions.json` fighting with `flake.lock`.

If exact human-readable package versions are needed in CI or release notes, derive them from the locked build inputs rather than re-declaring them in another file.

What is not yet required for v0:

- digest pinning for every container dependency
- a broad matrix of architecture-specific checksums unless and until multi-arch images are in scope

## User-Facing Environment Variables

Keep this minimal.

Current keepers:

- `PORT`
  - platform standard public port
- `DEPLOYERY_VERSION`
  - image/runtime version, informational and useful for debugging
- `DEPLOYERY_LOG_LEVEL`
- `DEPLOYERY_SKIP_SETUP`
  - boolean-style flag
  - when enabled, skip `/setup` and let stock code-server generate the first password

Current removals:

- `DEPLOYERY_STATE_ROOT`
- `DEPLOYERY_HOME`
- `DEPLOYERY_USER`
- `DEPLOYERY_DEFAULT_PORT`
- `DEPLOYERY_DISABLE_SETUP`

`PORT` stays because it is a platform contract, not a Deployery-specific configuration variable.

## Release and Update Model

Deployery should follow the same basic self-hosted update model used by products like `n8n`:

- publish versioned container images
- publish GitHub Releases / release notes
- do not self-update from inside the container
- operators update by deploying a newer image tag

Current recommendation:

- source of truth for binary distribution: container registry image tags
- source of truth for human-readable release info: GitHub Releases

The container should only:

- detect the currently running version
- compare it with the last completed version recorded in the bookkeeping file

The actual migration/update behavior is intentionally deferred until the v0 runtime exists. This document only reserves the bookkeeping location and the operator-facing update model.

## Research Notes

- Render and Railway both support the single-image plus single-volume model, but volume-backed services give up some no-downtime deployment behavior.
- `code-server` natively supports:
  - `hashed-password`
  - rate-limited login
  - cookie sessions
  - authenticated proxying
  - later external auth through reverse proxies
- `code-server` treats `$argon...` hashes as the modern `hashed-password` format and verifies them with Argon2
- `code-server` auto-creates `config.yaml` with a random password if the file does not exist, which is why Deployery needs an explicit `/setup` flow unless `DEPLOYERY_SKIP_SETUP` is enabled.
- when `code-server` generates a first-run password, it writes that password into `config.yaml` and logs the config path, not the password itself
- `n8n` uses the standard "publish image tags, redeploy to update" model and does not rely on in-container self-updating.
- Single-user Nix on a normal Linux base is the correct match for this product shape; full NixOS-in-container is not the plan.
- Full flakes are the preferred pinning mechanism for Deployery-managed runtime inputs.
