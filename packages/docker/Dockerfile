ARG RUNTIME_IMAGE=debian:trixie-slim@sha256:26f98ccd92fd0a44d6928ce8ff8f4921b4d2f535bfa07555ee5d18f61429cf0c

ARG NODE_VERSION=24.14.1
ARG NODE_SHA256_AMD64=84d38715d449447117d05c3e71acd78daa49d5b1bfa8aacf610303920c3322be
ARG NODE_SHA256_ARM64=71e427e28b78846f201d4d5ecc30cb13d1508ca099ef3871889a1256c7d6f67e
ARG CODE_SERVER_VERSION=4.114.0
ARG CODE_SERVER_SHA256_AMD64=97e4e828e2252ec261b6cb427eb6f1cd16196aea4ca346d6d2d1a34c9c246d86
ARG CODE_SERVER_SHA256_ARM64=ea917040a25881503ad314700b946f76b3bce9110c350b1f1cbbba6b8433ad47
ARG TSX_VERSION=4.21.0
ARG FLOW_ICONS_VERSION=1.3.2
ARG FLOW_ICONS_SHA256=3bb7514d1b8d86af44e343a3a2f3e2acbaed37616a24da0eff7e78b8b9929ad3
ARG DEPLOYERY_VERSION=unknown
ARG DEPLOYERY_DOCKER_VOLUME_PATH=/data
ARG BUILD_REVISION=unknown
# Fallback only for local builds that do not pass CI-derived source metadata.
ARG BUILD_SOURCE=https://github.com/sloikod/deployery

FROM ${RUNTIME_IMAGE}

ARG TARGETARCH
ARG NODE_VERSION
ARG NODE_SHA256_AMD64
ARG NODE_SHA256_ARM64
ARG CODE_SERVER_VERSION
ARG CODE_SERVER_SHA256_AMD64
ARG CODE_SERVER_SHA256_ARM64
ARG TSX_VERSION
ARG FLOW_ICONS_VERSION
ARG FLOW_ICONS_SHA256
ARG DEPLOYERY_VERSION
ARG DEPLOYERY_DOCKER_VOLUME_PATH
ARG BUILD_REVISION
ARG BUILD_SOURCE

ENV DEPLOYERY_VERSION=${DEPLOYERY_VERSION}
ENV DEPLOYERY_DOCKER_VOLUME_PATH=${DEPLOYERY_DOCKER_VOLUME_PATH}

# Install apt packages
RUN set -eu; \
  apt-get update; \
  DEBIAN_FRONTEND=noninteractive apt-get install -y --no-install-recommends \
    ca-certificates=20250419 \
    chromium=146.0.7680.177-1~deb13u1 \
    chromium-sandbox=146.0.7680.177-1~deb13u1 \
    curl=8.14.1-2+deb13u2 \
    git=1:2.47.3-0+deb13u1 \
    less=668-1 \
    nano=8.4-1 \
    passwd=1:4.17.4-2 \
    procps=2:4.0.4-9 \
    python3=3.13.5-1 \
    ripgrep=14.1.1-1+b4 \
    rsync=3.4.1+ds1-5+deb13u1 \
    sudo=1.9.16p2-3+deb13u1 \
    supervisor=4.2.5-3 \
    unzip=6.0-29 \
    util-linux=2.41-5 \
    vim-tiny=2:9.1.1230-2 \
    wget=1.25.0-2 \
    xz-utils=5.8.1-1 \
    zip=3.0-15

# Create runtime user
RUN useradd --create-home --shell /bin/bash --user-group user

# Install node
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) NODE_ARCH=x64; NODE_SHA="${NODE_SHA256_AMD64}" ;; \
    arm64) NODE_ARCH=arm64; NODE_SHA="${NODE_SHA256_ARM64}" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${NODE_ARCH}.tar.xz" -o /tmp/node.tar.xz; \
  printf '%s  %s\n' "${NODE_SHA}" /tmp/node.tar.xz | sha256sum -c -; \
  tar -xJf /tmp/node.tar.xz -C /usr/local --strip-components=1 --no-same-owner \
    "node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/node" \
    "node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/npm" \
    "node-v${NODE_VERSION}-linux-${NODE_ARCH}/bin/npx" \
    "node-v${NODE_VERSION}-linux-${NODE_ARCH}/lib/node_modules/npm"; \
  rm -f /tmp/node.tar.xz

# Install npm packages
RUN npm install -g tsx@${TSX_VERSION}

# Install code-server
RUN set -eu; \
  case "${TARGETARCH}" in \
    amd64) CS_SHA="${CODE_SERVER_SHA256_AMD64}" ;; \
    arm64) CS_SHA="${CODE_SERVER_SHA256_ARM64}" ;; \
    *) echo "Unsupported architecture: ${TARGETARCH}"; exit 1 ;; \
  esac; \
  curl -fsSL "https://github.com/coder/code-server/releases/download/v${CODE_SERVER_VERSION}/code-server-${CODE_SERVER_VERSION}-linux-${TARGETARCH}.tar.gz" -o /tmp/code-server.tar.gz; \
  printf '%s  %s\n' "${CS_SHA}" /tmp/code-server.tar.gz | sha256sum -c -; \
  mkdir -p /opt/code-server; \
  tar -xzf /tmp/code-server.tar.gz -C /opt/code-server; \
  ln -s "/opt/code-server/code-server-${CODE_SERVER_VERSION}-linux-${TARGETARCH}" /opt/code-server/current; \
  ln -s /opt/code-server/current/lib/vscode/bin/remote-cli/code-server /usr/local/bin/code; \
  ln -s /opt/code-server/current/bin/code-server /usr/local/bin/code-server; \
  rm -f /tmp/code-server.tar.gz

# Install code-server extensions
RUN set -eu; \
  curl -fsSL "https://open-vsx.org/api/thang-nm/flow-icons/${FLOW_ICONS_VERSION}/file/thang-nm.flow-icons-${FLOW_ICONS_VERSION}.vsix" -o /tmp/flow-icons.vsix; \
  printf '%s  %s\n' "${FLOW_ICONS_SHA256}" /tmp/flow-icons.vsix | sha256sum -c -; \
  su - user -c 'code-server --user-data-dir /home/user/.local/share/code-server --install-extension /tmp/flow-icons.vsix --force'; \
  rm -f /tmp/flow-icons.vsix

# Copy rootfs overlay
COPY packages/docker/rootfs/ /

# Patch code-server workbench UI
RUN node /opt/deployery/code-server/patch-workbench.mjs

# Configure runtime
RUN chmod 440 /etc/sudoers.d/user \
  && chown -R user:user /home/user \
  && chmod +x /opt/deployery/runtime/entrypoint.sh

# Image metadata
LABEL org.opencontainers.image.title="Deployery" \
  org.opencontainers.image.version="${DEPLOYERY_VERSION}" \
  org.opencontainers.image.revision="${BUILD_REVISION}" \
  org.opencontainers.image.source="${BUILD_SOURCE}"

EXPOSE 8080

ENTRYPOINT ["/opt/deployery/runtime/entrypoint.sh"]
