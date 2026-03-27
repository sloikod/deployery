#!/usr/bin/env bash
set -euo pipefail

mode="${1:-}"

if [ -z "${mode}" ]; then
  echo "Usage: $0 hardened" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH." >&2
  exit 1
fi

case "${mode}" in
  hardened)
    runtime="runsc"
    profile_label="Deployery hardened mode"
    fix_command="sudo runsc install && sudo systemctl restart docker"
    ;;
  *)
    echo "Unknown preflight mode: ${mode}" >&2
    echo "Expected: hardened" >&2
    exit 1
    ;;
esac

print_docker_access_hint() {
  local current_user current_groups docker_group_entry docker_group_members

  current_user="$(id -un 2>/dev/null || true)"
  current_groups="$(id -nG 2>/dev/null || true)"
  docker_group_entry="$(getent group docker 2>/dev/null || true)"
  docker_group_members=""

  if [ -n "${docker_group_entry}" ]; then
    docker_group_members="${docker_group_entry##*:}"
  fi

  if grep -Eq '(^|[[:space:]])docker($|[[:space:]])' <<<"${current_groups}"; then
    echo "Your current shell already has the docker group, so this looks like a host-level Docker socket or daemon issue." >&2
    return
  fi

  if [ -n "${current_user}" ] && [ -n "${docker_group_members}" ] && grep -Eq "(^|,)${current_user}(,|$)" <<<"${docker_group_members}"; then
    echo "Your user is already in the docker group, but this shell has not picked up that membership yet." >&2
    echo "Refresh the shell groups, then retry:" >&2
    echo "  newgrp docker" >&2
    echo "If that does not help, sign out and back in before re-running the command." >&2
    return
  fi

  echo "Add your user to the docker group, then refresh your shell groups:" >&2
  echo "  sudo usermod -aG docker \"\$USER\"" >&2
  echo "  newgrp docker" >&2
}

if ! runtimes_json="$(docker info --format '{{json .Runtimes}}' 2>&1)"; then
  echo "Unable to inspect Docker runtimes for ${profile_label}." >&2
  echo "${runtimes_json}" >&2
  echo "Make sure the Docker daemon is running and your user can access /var/run/docker.sock." >&2
  if grep -Fq "permission denied while trying to connect to the docker API" <<<"${runtimes_json}"; then
    print_docker_access_hint
  fi
  exit 1
fi

if ! grep -Fq "\"${runtime}\":" <<<"${runtimes_json}"; then
  echo "${profile_label} requires the Docker runtime alias '${runtime}', but Docker does not list it." >&2
  echo "Registered runtimes: ${runtimes_json}" >&2
  echo "Fix on the host:" >&2
  echo "  ${fix_command}" >&2
  exit 1
fi
