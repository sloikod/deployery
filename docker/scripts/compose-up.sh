#!/usr/bin/env bash
set -euo pipefail

clean="${1:-}"
gpu_mode="${DEPLOYERY_GPU:-auto}"

if [ "${clean}" != "" ] && [ "${clean}" != "clean" ]; then
  echo "Usage: $0 [clean]" >&2
  exit 1
fi

if ! command -v docker >/dev/null 2>&1; then
  echo "Docker is not installed or not on PATH." >&2
  exit 1
fi

case "${gpu_mode}" in
  auto|on|off)
    ;;
  *)
    echo "Unsupported DEPLOYERY_GPU='${gpu_mode}'." >&2
    echo "Expected one of: auto, on, off" >&2
    exit 1
    ;;
esac

have_nvidia_smi=0
if command -v nvidia-smi >/dev/null 2>&1; then
  have_nvidia_smi=1
fi

docker_runtimes="$(docker info --format '{{json .Runtimes}}' 2>/dev/null || true)"
have_nvidia_runtime=0
if [ -n "${docker_runtimes}" ] && grep -Fq '"nvidia":' <<<"${docker_runtimes}"; then
  have_nvidia_runtime=1
fi

gpu_available=0
if [ "${have_nvidia_smi}" -eq 1 ] && [ "${have_nvidia_runtime}" -eq 1 ]; then
  gpu_available=1
fi

use_gpu=0
case "${gpu_mode}" in
  auto)
    use_gpu="${gpu_available}"
    ;;
  on)
    if [ "${gpu_available}" -ne 1 ]; then
      echo "DEPLOYERY_GPU=on requested GPU support, but the host is not ready." >&2
      if [ "${have_nvidia_smi}" -ne 1 ]; then
        echo "Missing host NVIDIA tooling: 'nvidia-smi' is not available." >&2
      fi
      if [ "${have_nvidia_runtime}" -ne 1 ]; then
        echo "Docker does not list the 'nvidia' runtime." >&2
        if [ -n "${docker_runtimes}" ]; then
          echo "Registered runtimes: ${docker_runtimes}" >&2
        fi
      fi
      exit 1
    fi
    use_gpu=1
    ;;
  off)
    use_gpu=0
    ;;
esac

compose_args=(-f docker-compose.yml)
if [ "${use_gpu}" -eq 1 ]; then
  compose_args+=(-f docker-compose.gpu.yml)
fi

if [ "${clean}" = "clean" ]; then
  docker compose "${compose_args[@]}" down -v
fi

if [ "${use_gpu}" -eq 1 ]; then
  echo "Starting Deployery with GPU support."
else
  echo "Starting Deployery without GPU support."
fi

docker compose "${compose_args[@]}" up --build
