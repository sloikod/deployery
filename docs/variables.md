# Variables

## Public / deploy-time variables

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOYERY_DOMAIN` | `http://localhost` | Address Caddy should serve. Use `http://...` for local plain HTTP, or a real domain for automatic HTTPS. |
| `DEPLOYERY_BASE_URL` | `http://localhost:3131` | External base URL used when generating workflow resume and webhook URLs. |
| `DEPLOYERY_HOST_PORT` | `3131` | Default localhost port that Docker Compose publishes for the API/code-server entrypoint. |
| `PORT` | `3131` | HTTP port for the Deployery API process inside the container. |

## Sandbox runtime variables

| Variable | Default | Purpose |
|---|---|---|
| `DEPLOYERY_SANDBOX_ROOTFS` | `/` | Guest root path used by runtime diagnostics. |
| `DEPLOYERY_SANDBOX_HOME` | `/home/user` | Home directory for the sandbox user. |
| `DEPLOYERY_CODE_SERVER_PORT` | `13337` | Internal `code-server` bind port. |
| `DEPLOYERY_SANDBOX_ISOLATION_MODE` | `compatibility` | Operator-visible deployment profile, for example `compatibility` or `hardened-runsc`. |
| `DEPLOYERY_SANDBOX_RUNTIME` | `runc` | Container runtime name used by Docker, for example `runc` or `runsc`. |
| `DEPLOYERY_SANDBOX_SECCOMP_PROFILE` | `./docker/seccomp-deployery.json` | Seccomp profile applied to the sandbox container. The default profile blocks kernel exploit syscalls while allowing all normal usage including Chrome and desktop apps. |
| `DEPLOYERY_SANDBOX_GPU_COUNT` | `all` | Number of NVIDIA GPUs to reserve for the sandbox when GPU support is enabled for the `runc` path. In practice this takes effect when `docker-compose.gpu.yml` is active, whether selected explicitly or by `DEPLOYERY_GPU=auto|on`. |
| `DEPLOYERY_SANDBOX_NVIDIA_VISIBLE_DEVICES` | `all` | NVIDIA device selection passed into the container runtime. Useful for choosing specific GPU indexes or UUIDs on GPU-enabled hosts. |
| `DEPLOYERY_SANDBOX_NVIDIA_DRIVER_CAPABILITIES` | `compute,utility` | NVIDIA driver capabilities exposed to the sandbox. The default is aimed at CUDA / AI workloads. |
| `DEPLOYERY_SANDBOX_SHM_SIZE` | `1gb` | Shared memory size for the outer sandbox container. |
| `DEPLOYERY_SANDBOX_TMP_SIZE` | `8g` | `tmpfs` size for the outer sandbox container `/tmp`. |
| `DEPLOYERY_SANDBOX_RUN_SIZE` | `128m` | `tmpfs` size for the outer sandbox container `/run` (mounted with `exec` so `s6-overlay` can bootstrap). |

## Database selection

| Variable | Default | Purpose |
|---|---|---|
| `DB_TYPE` | `sqlite` | Database backend. Supported values: `sqlite`, `sqlitedb`, `postgres`, `postgresql`, `postgresdb`. |
| `DB_SQLITE_PATH` | `/var/lib/deployery/data/deployery.sqlite` | SQLite database path when `DB_TYPE=sqlite`. |
| `DEPLOYERY_SQLITE_PATH` | `/var/lib/deployery/data/deployery.sqlite` | Legacy SQLite path variable still supported as a fallback. |

## PostgreSQL variables

| Variable | Default | Purpose |
|---|---|---|
| `DB_POSTGRESDB_CONNECTION_URL` | unset | Full PostgreSQL connection string. |
| `DB_POSTGRESDB_HOST` | unset | PostgreSQL host when not using a connection URL. |
| `DB_POSTGRESDB_PORT` | `5432` | PostgreSQL port. |
| `DB_POSTGRESDB_DATABASE` | unset | PostgreSQL database name. |
| `DB_POSTGRESDB_USER` | unset | PostgreSQL user. |
| `DB_POSTGRESDB_PASSWORD` | unset | PostgreSQL password. |
| `DB_POSTGRESDB_SSL_ENABLED` | `false` | Enables TLS for PostgreSQL connections when set to `true`. |

## Secret file variants

Database variables support `_FILE` variants. For example:

```bash
DB_POSTGRESDB_PASSWORD_FILE=/run/secrets/deployery_db_password
```

When both the plain variable and the `_FILE` variant are set, the plain
variable wins.

## Drizzle tooling

`packages/persistence/drizzle.config.ts` uses SQLite by default and switches to
the PostgreSQL schema when `DB_TYPE=postgres`.
